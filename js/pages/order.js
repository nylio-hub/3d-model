var box = document.getElementById('orderPage');

var order = null;
var customer = null;
var worker = null;
var proposalList = [];
var messageList = [];
var reviewed = false;

async function load() {
  var data = await api('GET', '/orders/' + encodeURIComponent(getParam('id')));
  order = data.order;
  customer = data.customer;
  worker = data.worker;
  proposalList = data.proposals;
  messageList = data.messages;
  reviewed = data.hasReview;
}

async function init() {
  await startPage('orders');

  try {
    await load();
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  if (!order) {
    box.innerHTML = emptyBox(`Заказ не найден. <a href="${link('orders.html')}">Ко всем заказам</a>`);
  } else {
    render();
  }
}

init().catch(failPage);

// Выполняет действие на сервере и перерисовывает страницу по свежим данным
function perform(method, url, body) {
  return api(method, url, body).then(load).then(render).catch(function (error) {
    toast(error.message);
    return load().then(render).catch(function () {});
  });
}

function workflowBlock(isOwner, isWorker) {
  if (isWorker && order.status === 'in_progress') {
    return ` <div class="card mb-2"><h3>Работа в процессе</h3><p class="muted small">Когда модель будет готова, отправьте её заказчику на проверку.</p><button class="btn btn-primary" id="toReviewBtn">Сдать работу на проверку</button></div>`;
  }

  if (isOwner && order.status === 'review') {
    return ` <div class="card mb-2"><h3>Исполнитель сдал работу</h3><p class="muted small">Проверьте модель. После приёмки деньги уйдут исполнителю за вычетом комиссии.</p><div class="row"><button class="btn btn-primary" id="acceptWorkBtn">Принять работу</button><button class="btn btn-ghost" id="reworkBtn">Вернуть на доработку</button></div></div>`;
  }

  if (isOwner && order.status === 'done' && !reviewed) {
    return ` <div class="card mb-2"><h3>Оставьте отзыв об исполнителе</h3><div class="field"><label for="revRating">Оценка</label><select class="select" id="revRating"><option value="5">5 — отлично</option><option value="4">4 — хорошо</option><option value="3">3 — нормально</option><option value="2">2 — плохо</option><option value="1">1 — очень плохо</option></select></div><div class="field"><label for="revText">Комментарий</label><textarea class="textarea" id="revText" placeholder="Что понравилось, что можно улучшить"></textarea></div><button class="btn btn-primary" id="sendReviewBtn">Отправить отзыв</button></div>`;
  }

  if (order.status === 'done') {
    return '<div class="alert alert-success">Заказ завершён, отзыв оставлен.</div>';
  }

  return '';
}

function ownerActions(isOwner) {
  if (!isOwner) return '';

  if (order.status === 'open') {
    return ` <div class="card mb-2"><h3>Управление заказом</h3><p class="muted small">Пока исполнитель не выбран, условия можно менять.</p><div class="row row-wrap"><a class="btn btn-ghost" href="${link('create-order.html')}?edit=${order.id}">Редактировать</a><button class="btn btn-ghost" id="deleteOrderBtn">Удалить заказ</button></div></div>`;
  }

  if (order.status === 'in_progress' || order.status === 'review') {
    return ` <div class="card mb-2"><h3>Управление заказом</h3><p class="muted small">Если договориться не вышло, заказ можно отменить.</p><button class="btn btn-ghost" id="cancelOrderBtn">Отменить заказ</button></div>`;
  }

  return '';
}

function proposalsBlock(list, canAccept, user) {
  if (list.length === 0) {
    return ` <div class="card mb-2"><h3>Отклики</h3><p class="muted small mb-0">Пока никто не откликнулся на этот заказ.</p></div>`;
  }

  var html = '';
  for (var i = 0; i < list.length; i++) {
    var mine = user !== null && list[i].modelerId === user.id;
    var canWithdraw = mine && order.status === 'open' && list[i].status === 'sent';
    html += proposalItem(list[i], canAccept, canWithdraw);
  }
  return `<div class="card mb-2"><h3>Отклики (${list.length})</h3>${html}</div>`;
}

function hasMyProposal(user) {
  for (var i = 0; i < proposalList.length; i++) {
    if (proposalList[i].modelerId === user.id) return true;
  }
  return false;
}

function proposalForm(user) {
  if (order.status !== 'open') return '';

  if (!user) {
    return `<div class="alert"><a href="${link('login.html')}">Войдите</a> как модельер, чтобы откликнуться.</div>`;
  }
  if (user.role !== 'modeler') return '';
  if (hasMyProposal(user)) {
    return '<div class="alert alert-success">Вы уже откликнулись на этот заказ.</div>';
  }

  return ` <div class="card"><h3>Откликнуться на заказ</h3><div class="grid grid-2"><div class="field"><label for="prPrice">Ваша цена, рублей</label><input class="input" id="prPrice" type="number" min="500" step="500" value="${order.budget}"></div><div class="field"><label for="prDays">Срок, дней</label><input class="input" id="prDays" type="number" min="1" max="180" value="10"></div></div><div class="field"><label for="prMessage">Сообщение заказчику</label><textarea class="textarea" id="prMessage" placeholder="Что вы предлагаете сделать и в каком порядке"></textarea></div><div id="prError"></div><button class="btn btn-primary" id="sendProposalBtn">Отправить отклик</button></div>`;
}

function chatBlock(user, isOwner, isWorker) {
  if (!order.modelerId) return '';
  if (!isOwner && !isWorker) return '';

  var list = messageList;
  var html = '';

  for (var i = 0; i < list.length; i++) {
    var author = list[i].author;
    var mine = list[i].authorId === user.id ? 'is-mine' : '';
    html += `<div class="msg ${mine}"><div class="who">${safe(author.name)} · ${dateRu(list[i].createdAt)}</div><div>${safe(list[i].text)}</div></div>`;
  }

  return ` <div class="card mb-2"><h3>Переписка по заказу</h3><div class="chat"> ${html || '<div class="muted small">Сообщений пока нет. Напишите первое.</div>'} </div><div class="chat-form"><input class="input" id="msgText" placeholder="Написать сообщение" autocomplete="off"><button class="btn btn-primary" id="sendMsgBtn">Отправить</button></div></div>`;
}

function sidebarBlock() {
  var total = order.agreedPrice || order.budget;
  var fee = commissionOf(total);
  var left = daysLeft(order.deadline);

  var workerHtml = '';
  if (worker) {
    workerHtml = ` <div class="muted small mt-2 mb-1">Исполнитель</div><a class="row" href="${link('modeler.html')}?id=${worker.id}"><span class="avatar avatar-sm" style="background:${worker.color}">${initials(worker.name)}</span><b>${safe(worker.name)}</b></a>`;
  }

  return ` <aside class="card"><div class="muted small">${order.agreedPrice ? 'Согласованная сумма' : 'Бюджет заказчика'}</div><div class="sidebar-sum">${money(total)}</div><div class="money-box mb-2"><div class="money-line"><span class="muted">Сумма сделки</span><span>${money(total)}</span></div><div class="money-line"><span class="muted">Комиссия площадки</span><span class="green">${money(fee)}</span></div><div class="money-line total"><span>Исполнителю</span><span>${money(total - fee)}</span></div></div><div class="money-line"><span class="muted">Срок сдачи</span><span>${dateRu(order.deadline)}</span></div><div class="money-line"><span class="muted">Осталось</span><span>${left >= 0 ? left + ' ' + dayWord(left) : '<span class="danger">срок истёк</span>'}</span></div><div class="money-line"><span class="muted">Категория</span><span>${categoryName(order.categoryId)}</span></div><div class="sidebar-people"><div class="muted small mb-1">Заказчик</div><div class="row"><span class="avatar avatar-sm" style="background:${customer.color}">${initials(customer.name)}</span><b>${safe(customer.name)}</b></div> ${workerHtml} </div></aside>`;
}

function render() {
  document.title = order.title + ' — 3D Models';

  var user = currentUser();
  var isOwner = user !== null && user.id === order.customerId;
  var isWorker = user !== null && user.id === order.modelerId;
  var list = proposalList;
  var canAccept = isOwner && order.status === 'open';

  box.innerHTML = ` <div class="page-head"><a class="small muted" href="${link('orders.html')}">← Ко всем заказам</a><div class="row-between mt-2 mb-2"><h1 class="mb-0">${safe(order.title)}</h1> ${statusBadge(order.status)} </div> ${statusSteps(order.status)} </div><div class="order-layout"><div><div class="card mb-2"><h3>Описание задачи</h3><p class="muted">${safe(order.description)}</p><div class="row row-wrap mt-2"><span class="chip">${categoryName(order.categoryId)}</span><span class="chip">Опубликован ${dateRu(order.createdAt)}</span></div></div> ${workflowBlock(isOwner, isWorker)} ${ownerActions(isOwner)} ${chatBlock(user, isOwner, isWorker)} ${proposalsBlock(list, canAccept, user)} ${proposalForm(user)} </div> ${sidebarBlock()} </div>`;

  bindButtons(user);
}

function bindButtons(user) {
  var acceptButtons = document.querySelectorAll('.accept-btn');
  for (var i = 0; i < acceptButtons.length; i++) {
    acceptButtons[i].onclick = function () {
      perform('POST', '/proposals/' + this.dataset.id + '/accept');
    };
  }

  var withdrawButtons = document.querySelectorAll('.withdraw-btn');
  for (var w = 0; w < withdrawButtons.length; w++) {
    withdrawButtons[w].onclick = function () {
      if (!confirm('Отозвать свой отклик на этот заказ?')) return;
      perform('DELETE', '/proposals/' + this.dataset.id);
    };
  }

  var deleteOrder = document.getElementById('deleteOrderBtn');
  if (deleteOrder) {
    deleteOrder.onclick = function () {
      if (!confirm('Удалить заказ? Все отклики на него тоже удалятся.')) return;
      api('DELETE', '/orders/' + order.id).then(function () {
        location.href = link('orders.html');
      }, function (error) {
        toast(error.message);
      });
    };
  }

  var cancelOrder = document.getElementById('cancelOrderBtn');
  if (cancelOrder) {
    cancelOrder.onclick = function () {
      if (!confirm('Отменить заказ? Вернуть его в работу будет нельзя.')) return;
      perform('POST', '/orders/' + order.id + '/cancel');
    };
  }

  var toReview = document.getElementById('toReviewBtn');
  if (toReview) {
    toReview.onclick = function () {
      perform('POST', '/orders/' + order.id + '/submit');
    };
  }

  var acceptWork = document.getElementById('acceptWorkBtn');
  if (acceptWork) {
    acceptWork.onclick = function () {
      perform('POST', '/orders/' + order.id + '/approve');
    };
  }

  var rework = document.getElementById('reworkBtn');
  if (rework) {
    rework.onclick = function () {
      perform('POST', '/orders/' + order.id + '/rework');
    };
  }

  var sendReview = document.getElementById('sendReviewBtn');
  if (sendReview) {
    sendReview.onclick = function () {
      var text = document.getElementById('revText').value.trim();
      if (text.length < 5) {
        toast('Напишите несколько слов в отзыве');
        return;
      }
      perform('POST', '/orders/' + order.id + '/review', {
        rating: Number(document.getElementById('revRating').value),
        text: text
      });
    };
  }

  var sendMsg = document.getElementById('sendMsgBtn');
  if (sendMsg) {
    sendMsg.onclick = function () {
      var text = document.getElementById('msgText').value.trim();
      if (!text) return;
      perform('POST', '/orders/' + order.id + '/messages', { text: text });
    };

    document.getElementById('msgText').onkeydown = function (event) {
      if (event.key === 'Enter') sendMsg.onclick();
    };
  }

  var sendProposal = document.getElementById('sendProposalBtn');
  if (sendProposal) {
    sendProposal.onclick = function () {
      var price = Number(document.getElementById('prPrice').value);
      var days = Number(document.getElementById('prDays').value);
      var message = document.getElementById('prMessage').value.trim();
      var error = document.getElementById('prError');

      if (price < 500) {
        error.innerHTML = '<div class="error-text">Укажите цену не меньше 500 рублей</div>';
        return;
      }
      if (message.length < 10) {
        error.innerHTML = '<div class="error-text">Напишите пару предложений заказчику</div>';
        return;
      }

      api('POST', '/orders/' + order.id + '/proposals', {
        price: price,
        days: days,
        message: message
      }).then(load).then(render).catch(function (failure) {
        error.innerHTML = '<div class="error-text">' + safe(failure.message) + '</div>';
      });
    };
  }
}
