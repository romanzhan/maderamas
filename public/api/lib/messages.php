<?php

declare(strict_types=1);

// Формы обратной связи (бэкенд.md §14): контакт, Botón de Arrepentimiento, Libro de Quejas,
// отзыв на модерацию, «сообщить о поступлении». Один адрес, пять типов, одна таблица.

const MESSAGE_TYPES = ['contact', 'arrepentimiento', 'quejas', 'review', 'notify'];
// Юридические формы выдают номер обращения (seo.md п. 8): буква типа плюс номер записи
const MESSAGE_CODE_PREFIX = ['arrepentimiento' => 'A', 'quejas' => 'Q'];
const MESSAGES_PER_HOUR = 10;

/** Правила полей по типу — те же, что стоят в разметке форм (формы-и-поля.md п. 4, §6) */
function messageRules(string $type, array $runtime): array
{
    $pattern = fn (string $kind) => '/^(?:' . $runtime['patterns'][$kind] . ')$/u';
    $name = ['max' => 60, 'required' => true, 'pattern' => $pattern('nombre')];
    $email = ['max' => 120, 'required' => true, 'email' => true];
    $phone = ['max' => 10, 'required' => false, 'pattern' => $pattern('telefono')];

    return match ($type) {
        'contact' => [
            'nombre' => $name,
            'email' => $email,
            'mensaje' => ['max' => 500, 'min' => 10, 'required' => true, 'multiline' => true],
        ],
        'arrepentimiento' => [
            'nombre' => $name,
            'email' => $email,
            'telefono' => $phone,
            'pedido' => ['max' => 20, 'required' => false],
            'motivo' => ['max' => 500, 'required' => false, 'multiline' => true],
        ],
        'quejas' => [
            'nombre' => $name,
            'dni' => ['max' => 10, 'required' => true, 'digits' => true, 'pattern' => '/^\d{7,8}$/'],
            'email' => $email,
            // Слева — то, что должно победить: у массивов «+» оставляет ключи левого операнда
            'telefono' => ['required' => true] + $phone,
            'reclamo' => ['max' => 1000, 'min' => 20, 'required' => true, 'multiline' => true],
        ],
        'review' => [
            'producto' => ['max' => 60, 'required' => true, 'product' => true],
            'calificacion' => ['max' => 1, 'required' => true, 'pattern' => '/^[1-5]$/'],
            'nombre' => $name,
            'opinion' => ['max' => 1000, 'required' => true, 'min' => 20, 'multiline' => true],
        ],
        'notify' => [
            'email' => $email,
            'producto' => ['max' => 120, 'required' => true],
        ],
    };
}

/** Проверка полей сообщения: чистые значения и список полей с ошибками */
function validateMessage(string $type, mixed $input, array $runtime, array $catalog): array
{
    if (!is_array($input)) {
        return ['clean' => [], 'errors' => array_keys(messageRules($type, $runtime))];
    }

    $clean = [];
    $errors = [];
    foreach (messageRules($type, $runtime) as $field => $rule) {
        $value = cleanString($input[$field] ?? '', $rule['max'], $rule['multiline'] ?? false);
        if ($value !== null && !empty($rule['digits'])) {
            $value = str_replace('.', '', $value);
        }

        $bad = $value === null
            || ($rule['required'] && $value === '')
            || ($value !== '' && isset($rule['min']) && mb_strlen($value) < $rule['min'])
            || ($value !== '' && isset($rule['pattern']) && !preg_match($rule['pattern'], $value))
            || ($value !== '' && !empty($rule['email']) && filter_var($value, FILTER_VALIDATE_EMAIL) === false)
            || ($value !== '' && !empty($rule['product']) && findProduct($catalog, $value) === null);

        if ($bad) {
            $errors[] = $field;
            continue;
        }
        $clean[$field] = $value;
    }

    return ['clean' => $clean, 'errors' => $errors];
}

function messageCode(string $type, int $id): ?string
{
    $prefix = MESSAGE_CODE_PREFIX[$type] ?? null;

    return $prefix === null ? null : sprintf('%s-%06d', $prefix, $id);
}

function createMessage(PDO $db, string $type, array $data): array
{
    $now = nowUtc();
    $db->prepare('INSERT INTO messages (type, status, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)')
        ->execute([$type, 'new', $now, $now, json_encode($data, JSON_UNESCAPED_UNICODE)]);
    $id = (int) $db->lastInsertId();

    return ['id' => $id, 'code' => messageCode($type, $id)];
}

/** Строки «подпись: значение» для письма владельцу — подписи из словаря через runtime.json */
function messageFieldsText(array $data, array $labels): string
{
    $lines = [];
    foreach ($data as $field => $value) {
        if ($value === '') {
            continue;
        }
        $lines[] = ($labels[$field] ?? $field) . ': ' . $value;
    }

    return implode("\n", $lines);
}

/**
 * Письма по сообщению (бэкенд.md §14): владельцу — о каждом; покупателю — подтверждение
 * с номером обращения у юридических форм (норма — seo.md п. 8). Возвращает, ушло ли письмо
 * покупателю: null — не полагалось, true/false — результат.
 */
function notifyMessage(string $type, array $data, ?string $code): ?bool
{
    $runtime = runtime();
    $texts = $runtime['texts'];
    $typeName = $runtime['messageTypes'][$type] ?? $type;

    $ownerBody = [$typeName];
    if ($code !== null) {
        $ownerBody[] = fillText($texts['requestCode'], ['code' => $code]);
    }
    $ownerBody[] = '';
    $ownerBody[] = messageFieldsText($data, $runtime['labels']);
    sendMail($runtime['ownerEmail'], fillText($texts['ownerMessageSubject'], ['type' => $typeName]), implode("\n", $ownerBody));

    // Покупателю — номер и дословная копия того, что он отправил (норма для Libro
    // de Quejas — seo.md п. 8; для Botón de Arrepentimiento так же честно)
    if ($code !== null && !empty($data['email'])) {
        $subjectKey = $type === 'quejas' ? 'quejasSubject' : 'arrepentimientoSubject';
        $bodyKey = $type === 'quejas' ? 'quejasBody' : 'arrepentimientoBody';
        $body = implode("\n", [
            fillText($texts['greeting'], ['name' => $data['nombre'] ?? '']),
            '',
            fillText($texts[$bodyKey], ['code' => $code]),
            '',
            $texts['copyTitle'],
            messageFieldsText($data, $runtime['labels']),
            '',
            fillText($texts['questions'], ['phone' => $runtime['ownerPhone']]),
            '',
            $runtime['siteName'],
        ]);

        return sendMail($data['email'], $texts[$subjectKey], $body);
    }

    return null;
}

function messagesHandler(): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    throttle($db, 'messages', MESSAGES_PER_HOUR, HOUR_SECONDS);

    $input = readJsonBody();
    $type = $input['type'] ?? '';
    if (!is_string($type) || !in_array($type, MESSAGE_TYPES, true)) {
        fail(400, 'badRequest');
    }

    // Ловушка для ботов заполнена: «успех» с номером, которого не бывает, — записи
    // начинаются с единицы (бэкенд.md §7 п. 8)
    if (!empty($input['website'])) {
        logLine('info', 'honeypot', ['form' => $type]);
        jsonResponse(201, ['ok' => true, 'code' => messageCode($type, 0)]);
    }

    $runtime = runtime();
    ['clean' => $data, 'errors' => $errors] = validateMessage($type, $input['fields'] ?? null, $runtime, catalog());
    if ($errors !== []) {
        fail(422, 'invalidField', ['fields' => $errors]);
    }

    ['id' => $id, 'code' => $code] = createMessage($db, $type, $data);

    // Ответ уходит сразу, письма — после него: покупатель ждёт номер обращения, а не почту
    finishResponse(201, ['ok' => true, 'code' => $code]);
    $mailed = notifyMessage($type, $data, $code);
    if ($mailed !== null) {
        $db->prepare('UPDATE messages SET mail_status = ? WHERE id = ?')->execute([$mailed ? 'sent' : 'failed', $id]);
    }
    exit;
}
