import { defineConfig } from 'wxt';

// Манифест собирается из этого файла.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Без авто-импортов: каждый модуль импортируется явно, так проще искать по коду.
  imports: false,
  manifest: {
    // Публичный ключ расширения. С ним ID одинаковый на любом компьютере, где Binder
    // поставлен через «Загрузить распакованное»: gjbcclblodnhenbfjgfbbjhdmmmpenfh.
    // Этот ID указывается в OAuth-клиенте Google: если ключ поменять, вход сломается.
    // Приватный ключ не нужен: расширение не публикуется в сторе и не пакуется в .crx.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsZLU4Dg9y7jpHxm2NWh9MFR38L3EIGb+HtEaWdLXq+3DdU4bgpd3K/WcNNTqo6BcMNO5HUqrPMUYsJQckGLKh4dboQFs5V3I6IM2yO/zByNmJD2E3X58DDQM6uu+jEuFfSlK3G5qhsoMGlyNO6bcw1B/wg9za9pPbPM/i0c23Flp+kPaGzdv4P3vzqNVbICGL0hF7UveUScGkQcfB+nnle64pFa87tp0DBkSAq5LgWotDJXcVTBmmZSWbdOM9vAQfpE73ewOEkBLvutbBuuOXRw7MoTPnyUnXqA4djdvuNT2xO97dGNkry3fPopz8Ic1C+gYso8969Lwu9kHa1nyMQIDAQAB',
    name: 'Binder',
    description: 'Закрытый клуб коллекционеров: альбом настоящих карточек, цены и колоды.',
    permissions: ['storage', 'identity'],
    // Поиск японских карт по имени на limitlesstcg.com отдаёт HTML без CORS (src/lib/limitless.ts).
    // Их JSON и CDN со сканами разрешают запросы откуда угодно, им разрешение не нужно.
    host_permissions: ['https://limitlesstcg.com/*'],
    // OAuth-клиент типа Chrome Extension в Google Cloud (проект binder-54fb1), привязан к ID выше.
    // chrome.identity.getAuthToken берёт аккаунт, под которым залогинен Chrome.
    oauth2: {
      client_id: '934060415328-3nr528qh55pt1a0g0i6pmt19lcpj2no8.apps.googleusercontent.com',
      scopes: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    },
    // Chrome 135+: выпадающие списки оформлены через appearance: base-select (src/ui/Select.tsx).
    // CSS round() для заголовков Ретро есть с 125, так что ограничение задаёт Select.
    minimum_chrome_version: '135',
    action: { default_title: 'Binder' },
  },
  // WXT открывает свой Chrome с чистым профилем без входа в Google, а chrome.identity
  // берёт аккаунт профиля. Поэтому dev-сборку грузим в обычный профиль вручную.
  webExt: { disabled: true },
  // Порт по умолчанию 3000 на этой машине уже занят другим процессом (127.0.0.1:3000),
  // и dev-страницы могли бы обращаться не к тому серверу. Фиксированный порт честно
  // упадёт с ошибкой, если окажется занят.
  dev: { server: { port: 3127 } },
});
