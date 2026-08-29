// Плашка «нет сети»: браузер сам сообщает о разрыве и о восстановлении связи,
// опрашивать сеть не нужно (состояния-экранов.md п. 0).
export function offlineNotice() {
  return {
    offline: false,

    init() {
      const sync = () => {
        this.offline = !navigator.onLine
      }

      sync()
      window.addEventListener('online', sync)
      window.addEventListener('offline', sync)
    },
  }
}
