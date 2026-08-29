// Единственная точка доступа к производному catalog.json в браузере
// (сложные-узлы.md п. 3а, данные.md §8). Его читают корзина и поиск; до 28.08.2026
// каждый читал сам, своим кодом и со своим кешем — то есть один файл загружался
// дважды и ошибки разбирались по-разному. Модуль заведён вместе со вторым потребителем,
// как и было записано в отложенных задачах.
const CATALOG_URL = '/catalog.json'

let request = null

/** Каталог целиком: товары, категории и (при включённом блоге) статьи */
export function loadCatalog() {
  // Провал не кешируем: следующая попытка должна идти в сеть, иначе «Reintentar»
  // возвращал бы ту же ошибку до перезагрузки страницы
  request ??= fetch(CATALOG_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`catalog.json — ${response.status}`)
      return response.json()
    })
    .catch((error) => {
      request = null
      throw error
    })

  return request
}
