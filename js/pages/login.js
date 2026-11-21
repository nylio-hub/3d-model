var loginForm = document.getElementById('loginForm');
var registerForm = document.getElementById('registerForm');
var tabs = document.querySelectorAll('.tab');

function showTab(name) {
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('is-active', tabs[i].dataset.tab === name);
  }
  loginForm.hidden = name !== 'login';
  registerForm.hidden = name !== 'register';
}

for (var t = 0; t < tabs.length; t++) {
  tabs[t].onclick = function () {
    showTab(this.dataset.tab);
  };
}

if (getParam('tab') === 'register') showTab('register');

async function init() {
  await startPage('');

  var categoryOptions = '';
  for (var c = 0; c < categories.length; c++) {
    categoryOptions += `<option value="${categories[c].id}">${categories[c].name}</option>`;
  }
  document.getElementById('rgCategory').innerHTML = categoryOptions;
}

init().catch(failPage);

var roleInputs = document.querySelectorAll('input[name="role"]');
for (var r = 0; r < roleInputs.length; r++) {
  roleInputs[r].onchange = function () {
    document.getElementById('modelerFields').hidden = this.value !== 'modeler';
  };
}

loginForm.onsubmit = function (event) {
  event.preventDefault();

  var email = document.getElementById('liEmail').value;
  var password = document.getElementById('liPassword').value;
  var errorBox = document.getElementById('loginError');

  api('POST', '/auth/login', { email: email, password: password }).then(function () {
    location.href = link('account.html');
  }, function (error) {
    errorBox.innerHTML = `<div class="error-text">${safe(error.message)}</div>`;
  });
};

registerForm.onsubmit = function (event) {
  event.preventDefault();

  var name = document.getElementById('rgName').value.trim();
  var email = document.getElementById('rgEmail').value.trim();
  var password = document.getElementById('rgPassword').value;
  var city = document.getElementById('rgCity').value.trim();
  var role = document.querySelector('input[name="role"]:checked').value;
  var errorBox = document.getElementById('registerError');
  var error = '';

  if (name.length < 2) error = 'Введите имя';
  else if (email.indexOf('@') === -1) error = 'Введите корректный адрес почты';
  else if (password.length < 4) error = 'Пароль должен быть не короче 4 символов';

  if (error) {
    errorBox.innerHTML = `<div class="error-text">${error}</div>`;
    return;
  }

  var data = { name: name, email: email, password: password, city: city, role: role };
  if (role === 'modeler') {
    data.categoryId = document.getElementById('rgCategory').value;
    data.priceFrom = Number(document.getElementById('rgPrice').value) || 5000;
  }

  api('POST', '/auth/register', data).then(function () {
    location.href = link('account.html');
  }, function (failure) {
    errorBox.innerHTML = `<div class="error-text">${safe(failure.message)}</div>`;
  });
};
