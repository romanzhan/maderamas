// Формы обратной связи (бэкенд.md §14): какими словами словаря подписываются их поля
// и типы. Единственный источник списка: сборка кладёт испанские подписи в runtime.json
// для писем владельцу, а админка (/admin/) печатает по тем же полям русские —
// admin.field.<поле> и admin.msgType<Тип> в data/dictionaries/admin.ru.json. Новое поле
// формы добавляется здесь и получает подпись в обоих словарях: без русской сборка
// остановится на ключе, которого нет.

/** Поле формы → ключ словаря с подписью */
export const MESSAGE_FIELD_LABELS = {
  nombre: 'fields.name',
  email: 'fields.email',
  telefono: 'fields.phone',
  dni: 'fields.dni',
  mensaje: 'fields.message',
  pedido: 'fields.orderNumber',
  motivo: 'fields.reason',
  reclamo: 'fields.complaint',
  calificacion: 'reviews.rating',
  opinion: 'reviews.text',
  producto: 'messageLabels.product',
}

/** Тип формы (как у сервера) → ключ словаря с названием */
export const MESSAGE_TYPE_LABELS = {
  contact: 'messageLabels.typeContact',
  arrepentimiento: 'messageLabels.typeArrepentimiento',
  quejas: 'messageLabels.typeQuejas',
  review: 'messageLabels.typeReview',
  notify: 'messageLabels.typeNotify',
}
