var modeler = null;
var portfolio = [];
var feedback = [];

async function init() {
  await startPage('catalog');

  try {
    var data = await api('GET', '/modelers/' + encodeURIComponent(getParam('id')));
    modeler = data.modeler;
    portfolio = data.works;
    feedback = data.reviews;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  if (!modeler) {
    document.getElementById('profileHead').innerHTML =
      emptyBox(`Модельер не найден. <a href="${link('catalog.html')}">Вернуться в каталог</a>`);
    document.getElementById('profileTabs').hidden = true;
  } else {
    showProfile();
  }
}

init().catch(failPage);

function showProfile() {
  document.title = modeler.name + ' — 3D Models';

  document.getElementById('profileHead').innerHTML = ` 
    <div class="profile-head">
      <span class="avatar avatar-lg" style="background:${modeler.color}">${initials(modeler.name)}</span>
      <div class="info">
        <h1>${safe(modeler.name)}</h1>
        <p class="muted mb-1">${safe(modeler.spec)}</p>
        <div class="row row-wrap mb-2">
          <span class="rating-row"><span class="stars">★</span><b>${modeler.rating.toFixed(1)}</b><span class="muted">· ${feedback.length} ${plural(feedback.length, 'отзыв', 'отзыва', 'отзывов')}</span></span>
          <span class="chip">${safe(modeler.city)}</span>
          <span class="chip">${categoryName(modeler.categoryId)}</span>
        </div>
        <div class="grid grid-4">
          <div class="stat"><div class="v">${modeler.ordersDone}</div><div class="k">заказов выполнено</div></div>
          <div class="stat"><div class="v">${portfolio.length}</div><div class="k">работ в портфолио</div></div>
          <div class="stat"><div class="v">${modeler.days}</div><div class="k">дней средний срок</div></div>
          <div class="stat"><div class="v">${money(modeler.priceFrom)}</div><div class="k">минимальный заказ</div></div>
        </div>
      </div>
      <div class="profile-actions">
        <a class="btn btn-primary btn-lg" href="${link('create-order.html')}?modeler=${modeler.id}">Заказать модель</a>
        <a class="btn btn-ghost" href="${link('orders.html')}">Смотреть открытые заказы</a>
        <div class="muted tiny center">На площадке с ${dateRu(modeler.registered)} ${new Date(modeler.registered).getFullYear()}</div>
      </div>
    </div>`;

  var worksHtml = '';
  for (var i = 0; i < portfolio.length; i++) {
    worksHtml += workCard(portfolio[i]);
  }
  document.getElementById('tabWorks').innerHTML =
    `<div class="grid grid-3">${worksHtml || emptyBox('Работы пока не добавлены')}</div>`;

  var reviewsHtml = '';
  for (var j = 0; j < feedback.length; j++) {
    reviewsHtml += reviewItem(feedback[j]);
  }
  document.getElementById('tabReviews').innerHTML =
    `<div class="card">${reviewsHtml || emptyBox('Отзывов пока нет')}</div>`;

  var skillsHtml = '';
  for (var k = 0; k < modeler.skills.length; k++) {
    skillsHtml += `<span class="chip">${modeler.skills[k]}</span>`;
  }

  document.getElementById('tabAbout').innerHTML = ` 
    <div class="card">
      <h3>О себе</h3>
      <p class="muted">${safe(modeler.bio)}</p>
      <h3 class="mt-3">Навыки и инструменты</h3>
      <div class="row row-wrap">${skillsHtml}</div>
      <h3 class="mt-3">Условия работы</h3>
      <div class="money-box">
        <div class="money-line"><span class="muted">Минимальная стоимость заказа</span><span>${money(modeler.priceFrom)}</span></div>
        <div class="money-line"><span class="muted">Средний срок выполнения</span><span>${modeler.days} ${dayWord(modeler.days)}</span></div>
        <div class="money-line"><span class="muted">Оплата</span><span>через площадку</span></div>
      </div>
    </div>`;
}


function workCard(work) {
  
  var coverHtml = work.imageUrl
    ? `<div class="cover"><img src="${work.imageUrl}" alt="${safe(work.title)}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`
    : `<div class="cover" style="background-color:${work.color}"></div>`;

  return `
    <div class="card work-card">
      ${coverHtml}
      <div class="work-body">
        <div class="t">${safe(work.title)}</div>
        <div class="muted small mb-1">${money(work.price)}</div>
      </div>
    </div>`;
}

var tabs = document.querySelectorAll('.tab');
for (var t = 0; t < tabs.length; t++) {
  tabs[t].onclick = function () {
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('is-active');
    }
    this.classList.add('is-active');

    document.getElementById('tabWorks').hidden = this.dataset.tab !== 'works';
    document.getElementById('tabReviews').hidden = this.dataset.tab !== 'reviews';
    document.getElementById('tabAbout').hidden = this.dataset.tab !== 'about';
  };
}