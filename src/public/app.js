/* Ponte Guapa Shopping — tiny client JS (no frameworks) */
(function () {
  'use strict';

  /* ---- mobile menu toggle ---- */
  var burger = document.getElementById('hamburger');
  var panel = document.getElementById('mobile-panel');
  if (burger && panel) {
    burger.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---- image preview on file inputs ---- */
  document.querySelectorAll('input[type="file"][data-preview]').forEach(function (input) {
    var target = document.getElementById(input.getAttribute('data-preview'));
    if (!target) return;
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) { target.classList.remove('show'); target.removeAttribute('src'); return; }
      if (!f.type.match(/^image\//)) return;
      var url = URL.createObjectURL(f);
      target.src = url;
      target.classList.add('show');
    });
  });

  /* ---- pickup countdown: [data-deadline] ISO -> days left ---- */
  function tick() {
    var now = Date.now();
    document.querySelectorAll('[data-deadline]').forEach(function (el) {
      var d = new Date(el.getAttribute('data-deadline')).getTime();
      if (isNaN(d)) return;
      var days = Math.ceil((d - now) / 86400000);
      el.textContent = days < 0 ? '0' : String(days);
      var wrap = el.closest('.countdown');
      if (wrap && days <= 3) wrap.style.borderColor = '#ff4d6d';
    });
  }
  tick();
  setInterval(tick, 60000);

  /* ---- confirm dialogs on destructive forms ---- */
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var msg = form.getAttribute('data-confirm') || '¿Segura? / Are you sure?';
      if (!window.confirm(msg)) e.preventDefault();
    });
  });

  /* ---- qty steppers ---- */
  document.querySelectorAll('[data-qty-minus],[data-qty-plus]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-qty-target'));
      if (!input) return;
      var v = parseInt(input.value, 10) || 1;
      if (btn.hasAttribute('data-qty-minus')) v = Math.max(1, v - 1);
      else v = Math.min(99, v + 1);
      input.value = v;
    });
  });

  /* ---- checkout: pickup vs shipping toggle ---- */
  var pickupRadio = document.getElementById('opt-pickup');
  var shipFields = document.getElementById('ship-fields');
  function syncShip() {
    if (!pickupRadio || !shipFields) return;
    shipFields.style.display = pickupRadio.checked ? 'none' : '';
    shipFields.querySelectorAll('input,select,textarea').forEach(function (el) {
      if (pickupRadio.checked) { el.dataset.wasRequired = el.required ? '1' : ''; el.required = false; }
      else if (el.dataset.wasRequired) { el.required = true; }
    });
  }
  if (pickupRadio) {
    document.querySelectorAll('input[name="pickup"]').forEach(function (r) {
      r.addEventListener('change', syncShip);
    });
    syncShip();
  }

  /* ---- alt recipient toggle ---- */
  var altCheck = document.getElementById('alt-toggle');
  var altBox = document.getElementById('alt-fields');
  if (altCheck && altBox) {
    altCheck.addEventListener('change', function () {
      altBox.style.display = altCheck.checked ? '' : 'none';
    });
    altBox.style.display = altCheck.checked ? '' : 'none';
  }

  /* ---- whatsapp-order: add item rows ---- */
  var addRow = document.getElementById('wo-add-row');
  var rowsBox = document.getElementById('wo-rows');
  var rowTpl = document.getElementById('wo-row-template');
  if (addRow && rowsBox && rowTpl) {
    var n = rowsBox.querySelectorAll('.wo-row').length;
    addRow.addEventListener('click', function () {
      var html = rowTpl.innerHTML.replace(/__N__/g, String(n++));
      var div = document.createElement('div');
      div.className = 'wo-row';
      div.innerHTML = html;
      rowsBox.appendChild(div);
    });
    rowsBox.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-wo-remove]');
      if (rm) rm.closest('.wo-row').remove();
    });
  }
})();
