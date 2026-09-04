// Формы обратной связи (бэкенд.md §14): какими словами словаря подписываются их поля
// и типы. Единственный источник: сборка кладёт подписи в runtime.json для писем
// владельцу, и она же печатает их в разметку списка сообщений (/pedidos/). Новое поле
// формы добавляется здесь — и появляется в обоих местах.

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
  producto: 'admin.msgProduct',
}

/** Тип формы (как у сервера) → ключ словаря с названием */
export const MESSAGE_TYPE_LABELS = {
  contact: 'admin.msgTypeContact',
  arrepentimiento: 'admin.msgTypeArrepentimiento',
  quejas: 'admin.msgTypeQuejas',
  review: 'admin.msgTypeReview',
  notify: 'admin.msgTypeNotify',
}
