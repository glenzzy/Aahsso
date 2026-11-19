/* Aahsso — first-time tour: Buy → Ship → Receive → Sell.
 * Shown once per device to someone who can record purchases and has no stock yet; "Take the tour" on Home
 * replays it. Each step opens the real page behind the card, highlights it in the menu and offers one action. */
const TOUR_KEY = 'aahsso-tour-done';
const TOUR = [
  { r: null, title: 'Welcome to Aahsso', lead: 'Your goods move in four steps. Aahsso follows each one, so you always know where your stock and your money are.', intro: true },
  { r: 'buy', title: 'Buy', lead: 'Record what you bought, as soon as you buy it.', points: ['Who you bought from: a shop, the black market, a person…', 'Each item, how many and the price', 'Tax in % or as an amount — shared over the items for you', 'Paid, part paid or still owed'], tip: 'Bought in Cameroon? It goes straight to stock — no Ship or Receive.', act: ['newPurchase', 'Record a purchase', 'purchases'] },
  { r: 'ship', title: 'Ship', lead: 'Group what you bought abroad into a shipment.', points: ['Your purchases wait here until they are shipped', 'Add the container number and loading date', 'Add shipping costs: freight, BESC, tests…'], act: ['newShip', 'Start a shipment', 'containers'] },
  { r: 'receive', title: 'Receive', lead: 'When the shipment reaches Cameroon, tick off four steps.', points: ['Mark it arrived', 'Add customs and clearing costs', 'Unload and count — the goods are now in stock', 'Check prices and print labels'], tip: 'Every cost is spread over the items, so you see the real cost of each one.' },
  { r: 'sales', title: 'Sell', lead: 'Sell at the shop, by phone or on social media.', points: ['Tap New sale, then search or scan an item', 'Get paid by cash, MTN MoMo or Orange Money', 'Send the receipt by WhatsApp', 'See who owes you and remind them'], act: ['newSale', 'Make a sale', 'sell'] },
];
/* Aahsso Store: buy locally → keep stock right → sell */
const STORE_TOUR = [
  { r: null, title: 'Welcome to Aahsso', lead: 'Your shop in three steps: buy, keep your stock right, sell. Aahsso keeps the numbers, so you always know what you have and what you made.', intro: true },
  { r: 'buy', title: 'Buy', lead: 'Record what you buy from your suppliers.', points: ['Who you bought from', 'Each item, how many and the price', 'Paid, part paid or still owed — Aahsso reminds you'], tip: 'It goes straight into your stock, ready to sell.', act: ['newPurchase', 'Record a purchase', 'purchases'] },
  { r: 'stock', title: 'Stock', lead: 'See what you have, at a glance.', points: ['What you have and what it is worth', 'What is running low — also on your Home', 'Selling prices worked out from what you paid'] },
  { r: 'sales', title: 'Sell', lead: 'Sell at the till, by phone or on social media.', points: ['Tap New sale, then search or scan an item', 'Get paid by cash, MTN MoMo or Orange Money', 'Send the receipt by WhatsApp', 'See who owes you and remind them'], act: ['newSale', 'Make a sale', 'sell'] },
];
/* Aahsso Bar & Resto: tables & QR → orders → kitchen → bill */
const RESTO_TOUR = [
  { r: null, title: 'Welcome to Aahsso', lead: 'Your bar or restaurant in four steps: the menu, the tables, the orders, the bill. Aahsso keeps the stock and the money right.', intro: true },
  { r: 'menu', title: 'Menu', lead: 'Add what you serve.', points: ['Price, category and photo', 'From stock: a bottle of beer takes one bottle', 'Sold out with one switch — it leaves the QR menu'] },
  { r: 'floor', title: 'Tables', lead: 'Your tables, live.', points: ['Add areas and tables, print their QR codes', 'Colours show new orders, food ready, bill asked', 'Tap a table for its orders and its bill'] },
  { r: 'tickets', title: 'Orders', lead: 'Customers order from their phone.', points: ['The waiter accepts, the kitchen and bar prepare', 'Mark it served when it reaches the table', 'Bill: cash or MoMo, the table is free again'] },
];
const tourSteps = () => (K.info && K.info.edition === 'resto' ? RESTO_TOUR : isStore() ? STORE_TOUR : TOUR).filter((s) => !s.r || navOk(s.r));
const tourDone = () => { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return true; } };
/** Ring the menu item of the current step (sidebar and phone bar); called again after every redraw. */
function tourMark() {
  $$('.tour-hl').forEach((e) => e.classList.remove('tour-hl'));
  const st = K.tour && tourSteps()[K.tour.i]; if (!st || !st.r) return;
  (st.r === 'sales' ? ['#sales', '#sell'] : ['#' + st.r]).forEach((h) => $$('#side a.nav[href="' + h + '"], #bnav a[href="' + h + '"]').forEach((e) => e.classList.add('tour-hl')));
  // phone: Ship and Receive live under More
  const bar = $('#bnav'); if (bar && bar.offsetParent && !$('#bnav .tour-hl')) { const m = $('#bnav [data-a=moreMenu]'); if (m) m.classList.add('tour-hl'); }
}
function tourDraw() {
  const steps = tourSteps(); const i = K.tour.i; const st = steps[i]; const last = i === steps.length - 1;
  const flow = steps.filter((s) => s.r); const fi = flow.indexOf(st);
  let el = $('#tour');
  if (!el) { el = document.createElement('section'); el.id = 'tour'; el.className = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'tourT'); document.body.appendChild(el); }
  el.classList.toggle('tour-intro', !!st.intro);
  const canAct = st.act && can(st.act[2]);
  el.innerHTML = '<button class="icon-btn tour-x" data-a="tourEnd" aria-label="Close the tour">' + ic('x', 'sm') + '</button>' +
    '<div class="tour-flow" aria-hidden="true">' + flow.map((s, k) => '<span class="' + (k === fi ? 'on' : k < fi ? 'done' : '') + '"><b>' + (k + 1) + '</b>' + esc(s.title) + '</span>').join('<i>›</i>') + '</div>' +
    (st.intro ? '' : '<div class="tour-step">Step ' + (fi + 1) + ' of ' + flow.length + '</div>') +
    '<h2 id="tourT">' + esc(st.title) + '</h2><p class="tour-lead">' + esc(st.lead) + '</p>' +
    (st.points ? '<ul class="tour-pts">' + st.points.map((p) => '<li>' + ic('check', 'sm') + '<span>' + esc(p) + '</span></li>').join('') + '</ul>' : '') +
    (st.tip ? '<p class="tour-tip">' + esc(st.tip) + '</p>' : '') +
    '<div class="tour-foot">' + (i > 0 ? '<button class="btn ghost" data-a="tourGo" data-d="-1">Back</button>' : '<button class="btn ghost" data-a="tourEnd">Skip</button>') + '<div class="sp"></div>' +
      (canAct ? '<button class="btn" data-a="tourTry" data-v="' + st.act[0] + '">' + esc(st.act[1]) + '</button>' : '') +
      '<button class="btn pri" data-a="tourGo" data-d="1">' + (st.intro ? 'Show me' : last ? 'Done' : 'Next') + '</button></div>';
  if (st.r && K.route !== st.r) go(st.r);
  setTimeout(tourMark, 80);
  const f = $('.tour-foot .btn.pri', el); if (f) f.focus({ preventScroll: true });
}
function startTour() { while (K.sheets.length) closeSheet(); K.tour = { i: 0 }; tourDraw(); }
function endTour() { K.tour = null; try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { } const el = $('#tour'); if (el) el.parentNode.removeChild(el); tourMark(); }
A.tourStart = () => startTour();
A.tourEnd = () => endTour();
A.tourGo = (el) => {
  const n = K.tour.i + num(el.dataset.d);
  if (n >= tourSteps().length) { endTour(); if (K.route !== 'home') go('home'); toast('You are ready — start with Buy'); return; }
  K.tour.i = Math.max(0, n); tourDraw();
};
A.tourTry = (el) => { const v = el.dataset.v; endTour(); A[v](); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && K.tour && !K.sheets.length) endTour(); });
/** First visit: start the tour once, for people who set things up (not for sales-only staff). */
function maybeTour() {
  if (K.info.supportView || K.tour || tourDone() || !K.member || !can('purchases') || K.raw.products.length || K.sheets.length || K.sync === 'loading') return;
  setTimeout(() => { if (!K.tour && !tourDone() && K.route === 'home' && !K.sheets.length && !K.raw.products.length) startTour(); }, 500);
}
