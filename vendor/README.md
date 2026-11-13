# Локальные библиотеки

Фиксированные версии зависимостей, чтобы запуск камеры и моделей не зависел от внешнего CDN.

- Three.js 0.160.0: https://www.npmjs.com/package/three/v/0.160.0 — MIT, лицензия в `three/LICENSE`.
- MindAR 1.2.5: https://www.npmjs.com/package/mind-ar/v/1.2.5 — лицензия в `mindar/LICENSE`.
- Файлы получены с https://cdn.jsdelivr.net/npm/ с явно указанными версиями.

Исходные файлы библиотек сохранены без изменений. Собственная обработка запуска/остановки
MindAR находится в `js/ar-session.js`; Three.js addons загружаются через importmap.
