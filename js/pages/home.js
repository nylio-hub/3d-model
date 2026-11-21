var modelers = [];
var openOrders = [];
var stats = null;

async function init() {
  await startPage('');

  stats = await api('GET', '/stats');
  modelers = (await api('GET', '/modelers')).modelers;
  openOrders = (await api('GET', '/orders?status=open')).orders;

  showHome();
}

init().catch(failPage);

function showHome() {

document.getElementById('heroStats').innerHTML = ` <div><div class="v">${modelers.length}</div><div class="k">${plural(modelers.length, 'модельер', 'модельера', 'модельеров')}</div></div><div><div class="v">${stats.works}</div><div class="k">${plural(stats.works, 'работа', 'работы', 'работ')} в портфолио</div></div><div><div class="v green">${openOrders.length}</div><div class="k">${plural(openOrders.length, 'открытый', 'открытых', 'открытых')} ${orderWord(openOrders.length)}</div></div>`;

var categoriesHtml = '';
for (var c = 0; c < categories.length; c++) {
  var count = 0;
  for (var m = 0; m < modelers.length; m++) {
    if (modelers[m].categoryId === categories[c].id) count++;
  }
  categoriesHtml += ` <a class="card card-hover cat-card" href="${link('catalog.html')}?cat=${categories[c].id}"><span><span class="n">${categories[c].name}</span><br><span class="muted tiny">${count} ${plural(count, 'модельер', 'модельера', 'модельеров')}</span></span></a>`;
}
document.getElementById('categories').innerHTML = categoriesHtml;

var best = modelers.slice();
best.sort(function (a, b) {
  return b.rating - a.rating;
});

var modelersHtml = '';
for (var b = 0; b < 6 && b < best.length; b++) {

  var m = best[b];
  var coverHtml = m.imageUrl 
  ? `<div class="cover" style="height:200px;overflow:hidden;border-radius:12px 12px 0 0;"><img src="${m.imageUrl}" alt="${safe(m.name)}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`
  : `<div class="cover" style="height:200px;background-color:${m.color};border-radius:12px 12px 0 0;"></div>`;
  
  modelersHtml += `
    <a class="card card-hover modeler-card" href="${link('modeler.html')}?id=${m.id}">
      ${coverHtml}
      <div class="modeler-info">
        <div class="row row-between mb-1">
          <span class="chip tiny">${categoryName(m.categoryId)}</span>
          <span class="muted tiny">${safe(m.city)}</span>
        </div>
        <div class="t mb-1">${safe(m.name)}</div>
        <div class="muted small mb-2">${safe(m.spec)}</div>
        <div class="row row-between">
          <div class="price">от ${money(m.priceFrom)}</div>
          <div class="rating-row"><span class="stars">★</span><b>${m.rating.toFixed(1)}</b><span class="muted tiny">· ${m.ordersDone} ${plural(m.ordersDone, 'заказ', 'заказа', 'заказов')}</span></div>
        </div>
      </div>
    </a>`;
}
document.getElementById('topModelers').innerHTML = modelersHtml ||
  emptyBox(`Модельеров пока нет. <a href="${link('login.html')}?tab=register">Зарегистрироваться как исполнитель</a>`);
bindFavorites();

sortByDate(openOrders);
var ordersHtml = '';
for (var o = 0; o < 3 && o < openOrders.length; o++) {
  ordersHtml += orderCard(openOrders[o]);
}
document.getElementById('openOrders').innerHTML = ordersHtml ||
  emptyBox(`Открытых заказов пока нет. <a href="${link('create-order.html')}">Разместить первый</a>`);

var sumInput = document.getElementById('commTotal');
var resultBox = document.getElementById('commResult');

document.getElementById('commRate').textContent = commissionPercent();

function showCommission() {
  var total = Number(sumInput.value) || 0;
  var fee = commissionOf(total);

  resultBox.innerHTML = ` <div class="money-line"><span class="muted">Заказчик платит</span><span>${money(total)}</span></div><div class="money-line"><span class="muted">Комиссия площадки, ${commissionPercent()}</span><span class="green">${money(fee)}</span></div><div class="money-line total"><span>Получает исполнитель</span><span>${money(total - fee)}</span></div>`;
}

sumInput.oninput = showCommission;
showCommission();
}