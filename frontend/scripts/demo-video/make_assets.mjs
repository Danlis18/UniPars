// Генерує демонстраційні PDF для запису відео (вигадані автори, лише імена).
// node scripts/demo_video/make_assets.mjs <папка>
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const css = `
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: "Times New Roman", serif; font-size: 13.5pt; line-height: 1.45; color: #111; }
  .cover { text-align: center; height: 245mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
  .cover h1 { font-size: 20pt; margin: 0 0 8mm; } .cover .topic { font-size: 16pt; font-weight: bold; }
  .who { text-align: right; } h2 { font-size: 15pt; margin: 6mm 0 2mm; }
  pre { font-family: Consolas, monospace; font-size: 10.5pt; background: #f3f5f4; border: 1px solid #d5dbd8; padding: 4mm; border-radius: 2mm; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; font-size: 11.5pt; } td, th { border: 1px solid #999; padding: 1.5mm 2.5mm; }
  th { background: #eef2f0; }`;

const cover = (n, topic, subject, author, group) => `
  <div class="cover">
    <div>Міністерство освіти і науки України<br>Львівський національний університет імені Івана Франка<br>Факультет електроніки та комп'ютерних технологій</div>
    <div><h1>Звіт про виконання лабораторної роботи №${n}</h1><div class="topic">«${topic}»</div><div style="margin-top:6mm">з дисципліни «${subject}»</div></div>
    <div class="who">Виконав(ла): ${author}, ${group}<br>Перевірив: викладач кафедри</div>
    <div>Львів — ${new Date().getFullYear()}</div>
  </div>`;

const NET = "Комп'ютерні інформаційні мережі та системи";
const trace = `$ traceroute 8.8.8.8
 1  192.168.0.1      1.214 ms   1.102 ms   1.087 ms
 2  * * *
 3  10.48.0.1        8.731 ms   8.604 ms   9.112 ms
 4  194.44.208.17   10.913 ms  11.020 ms  10.876 ms
 5  72.14.215.85    21.447 ms  21.391 ms  21.502 ms
 6  8.8.8.8         22.018 ms  21.977 ms  22.064 ms`;

const docs = {
  "report-net9.pdf": cover(9, "Маршрутизація: ping і traceroute", NET, "Софія", "ФЕП-11") + `
    <h2>Мета роботи</h2><p>Навчитися перевіряти досяжність вузлів командою ping і досліджувати маршрут пакетів командою traceroute.</p>
    <h2>Хід роботи</h2><p>1. Перевірка доступності вузла 8.8.8.8: 10 пакетів, втрати 0%, середній час 21.9 мс.</p>
    <pre>$ ping -c 10 8.8.8.8
10 packets transmitted, 10 received, 0% packet loss
rtt min/avg/max = 21.402/21.913/22.611 ms</pre>
    <p>2. Маршрут до 8.8.8.8:</p><pre>${trace}</pre>
    <table><tr><th>Перехід</th><th>Вузол</th><th>Затримка</th><th>Пояснення</th></tr>
    <tr><td>1</td><td>192.168.0.1</td><td>1.1 мс</td><td>Домашній маршрутизатор</td></tr>
    <tr><td>2</td><td>* * *</td><td>—</td><td>Вузол не відповідає на пробні пакети; маршрут не обірвано</td></tr>
    <tr><td>3–5</td><td>мережа провайдера</td><td>8–21 мс</td><td>Магістральні маршрутизатори</td></tr>
    <tr><td>6</td><td>8.8.8.8</td><td>22.0 мс</td><td>Кінцевий вузол</td></tr></table>
    <h2>Висновки</h2><p>Рядок «* * *» означає, що маршрутизатор на другому переході не надсилає відповіді ICMP, але пересилає пакети далі — наступні переходи видно. Найбільший приріст затримки — між мережею провайдера та зовнішнім каналом.</p>`,
  "danylo-lr9.pdf": cover(9, "Маршрутизація: ping і traceroute", NET, "Данило", "ФЕП-12") + `
    <h2>Мета роботи</h2><p>Дослідити досяжність вузлів і маршрут пакетів у мережі.</p><h2>Маршрут</h2><pre>${trace}</pre>
    <p>На другому переході вузол не відповів на пробні пакети (* * *), але маршрут далі не обірвався.</p>
    <h2>Висновки</h2><p>Маршрут до 8.8.8.8 проходить через 6 переходів, середня затримка — 22 мс.</p>`,
  "metodychka-lr9.pdf": `<h1 style="font-size:18pt">Методичні вказівки до лабораторної роботи №9</h1><p><b>Тема:</b> Маршрутизація: ping і traceroute.</p>
    <h2>Теоретичні відомості</h2><p>Команда ping надсилає ICMP Echo Request і вимірює час відповіді. Команда traceroute надсилає пакети зі зростаючим TTL; кожен маршрутизатор, на якому TTL закінчується, повідомляє про себе.</p>
    <h2>Завдання</h2><ol><li>Перевірити доступність двох вузлів.</li><li>Побудувати маршрут до 8.8.8.8.</li><li>Пояснити рядки з «* * *».</li><li>Зробити висновки.</li></ol>`,
  "report-arch7.pdf": cover(7, "Семисегментні індикатори U2 та U3", "Архітектура комп'ютерів та комп'ютерна електроніка", "Данис", "ФЕП-14") + `
    <h2>Хід роботи</h2><p>Індикатори U2 та U3 відображають по одній шістнадцятковій цифрі. U2 — старша цифра, U3 — молодша.</p>
    <table><tr><th>Вхідний код</th><th>U2</th><th>U3</th><th>Значення</th></tr><tr><td>0101 0101</td><td>5</td><td>5</td><td>55₁₆ = 85₁₀</td></tr><tr><td>1010 1111</td><td>A</td><td>F</td><td>AF₁₆ = 175₁₀</td></tr></table>
    <h2>Висновки</h2><p>Два індикатори разом показують байт у шістнадцятковому вигляді.</p>`,
  "report-net8.pdf": cover(8, "Стек протоколів", NET, "Артем", "ФЕП-12") + `<h2>Хід роботи</h2><p>Аналіз пакетів у Wireshark: Ethernet → IP → TCP → HTTP.</p>`,
  "report-prog7.pdf": cover(7, "Функції", "Основи програмування", "Марія", "ФЕП-11") + `<h2>Код</h2><pre>int max(int a, int b) { return a > b ? a : b; }</pre>`,
  "report-ipz8.pdf": cover(8, "Прототип вебсторінки", "Основи інженерії програмного забезпечення", "Максим", "ФЕП-14") + `<h2>Хід роботи</h2><p>Створено HTML-прототип сторінки з формою.</p>`,
  "report-arch6.pdf": cover(6, "Регістри пам'яті та зсуву", "Архітектура комп'ютерів та комп'ютерна електроніка", "Олена", "ФЕП-13") + `<h2>Хід роботи</h2><p>Досліджено режими паралельного й послідовного запису.</p>`,
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, body] of Object.entries(docs)) {
  await page.setContent(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
  await page.pdf({ path: join(out, name), format: "A4", printBackground: true });
}
await browser.close();
console.log("assets:", Object.keys(docs).length);
