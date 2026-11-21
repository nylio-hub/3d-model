var categories = [];
var me = null;

var COMMISSION = 0.02;

function api(method, url, body) {
  var options = {
    method: method,
    credentials: 'same-origin',
    headers: {}
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  return fetch('/api' + url, options).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) {
        var error = new Error(data.error || 'Что-то пошло не так. Попробуйте ещё раз');
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }, function () {
    throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз');
  });
}

function loadSession() {
  return api('GET', '/session').then(function (data) {
    me = data.user;
    categories = data.categories;
  });
}

function findCategory(id) {
  for (var i = 0; i < categories.length; i++) {
    if (categories[i].id === id) return categories[i];
  }
  return null;
}

function categoryName(id) {
  var category = findCategory(id);
  return category ? category.name : '';
}

function commissionOf(sum) {
  return Math.round(sum * COMMISSION);
}

function commissionPercent() {
  return String(Math.round(COMMISSION * 10000) / 100).replace('.', ',') + '%';
}

function sortByDate(list) {
  list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  return list;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
