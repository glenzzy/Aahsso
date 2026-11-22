/* Aahsso Bar & Resto — kitchen ingredients (Cameroon): what restaurants buy to cook, with local names for searching.
 * Owners pick from it in Buy → "Buy ingredients"; anything missing they type themselves. No prices: markets change daily.
 * unit = how it is counted in stock; pack = a usual pack it is bought in (eggs by the tray). */
const Ingredients = (() => {
  const L = (cat, rows) => rows.map(([name, unit, aka, pack]) => ({ cat, name, unit, aka: aka || '', pack: pack || null }));
  const RAW = [].concat(
    L('Vegetables & leaves', [
      ['Onion', 'kg', 'oignon'], ['Red onion', 'kg', 'oignon rouge'], ['Spring onion', 'bunch', 'ciboule green onion'], ['Tomato', 'kg', 'tomate'], ['Garlic', 'kg', 'ail'],
      ['Ginger', 'kg', 'gingembre'], ['Fresh pepper (piment)', 'kg', 'piment hot pepper chili'], ['Green pepper (poivron)', 'kg', 'poivron bell pepper'], ['Carrot', 'kg', 'carotte'],
      ['Cabbage', 'piece', 'chou'], ['Lettuce', 'piece', 'laitue salade'], ['Cucumber', 'piece', 'concombre'], ['Leek', 'bunch', 'poireau'], ['Celery', 'bunch', 'celeri celeri'],
      ['Parsley', 'bunch', 'persil'], ['African basil (massep)', 'bunch', 'massep basilic'], ['Bitter leaf (ndolè)', 'kg', 'ndole bitterleaf'], ['Eru / okok', 'kg', 'eru okok koko'],
      ['Waterleaf', 'bunch', 'waterleaf'], ['Okra (gombo)', 'kg', 'gombo okro'], ['Huckleberry (njama njama)', 'bunch', 'njama njama'], ['Pumpkin leaves', 'bunch', 'feuilles de courge'],
      ['Cassava leaves (kpwem)', 'kg', 'kpem feuilles de manioc'], ['Spinach (folong)', 'bunch', 'folong epinard amaranth'], ['Garden egg / eggplant', 'kg', 'aubergine'],
      ['Green beans', 'kg', 'haricots verts'], ['Avocado', 'piece', 'avocat'], ['Mushrooms', 'kg', 'champignons'],
    ]),
    L('Tubers, plantain & grains', [
      ['Plantain, ripe', 'bunch', 'plantain mur'], ['Plantain, unripe', 'bunch', 'plantain vert'], ['Cassava', 'kg', 'manioc'], ['Cocoyam (macabo)', 'kg', 'macabo'], ['Taro', 'kg', 'taro'],
      ['Yam', 'kg', 'igname'], ['Sweet potato', 'kg', 'patate douce'], ['Irish potato', 'kg', 'pomme de terre'], ['Rice, long grain', 'kg', 'riz'], ['Rice, perfumed', 'kg', 'riz parfume jasmine'],
      ['Maize / corn', 'kg', 'mais'], ['Spaghetti', 'packet', 'pates'], ['Macaroni', 'packet', 'pates'], ['Bobolo / miondo', 'piece', 'baton de manioc bobolo miondo'],
      ['Water fufu', 'kg', 'fufu couscous manioc'], ['Garri', 'kg', 'gari tapioca'], ['Corn flour (couscous)', 'kg', 'farine de mais couscous'], ['Wheat flour', 'kg', 'farine de ble'], ['Semolina', 'kg', 'semoule'],
    ]),
    L('Beans, nuts & seeds', [
      ['Red beans', 'kg', 'haricot rouge'], ['White beans (niébé)', 'kg', 'niebe cowpeas black eyed'], ['Groundnuts', 'kg', 'arachides peanuts'], ['Egusi (pistache)', 'kg', 'pistache melon seeds'],
      ['Njansang', 'kg', 'djansang akpi'], ['Sesame', 'kg', 'sesame'], ['Coconut', 'piece', 'noix de coco'], ['Palm nuts', 'kg', 'noix de palme'],
    ]),
    L('Oils & fats', [
      ['Palm oil', 'litre', 'huile rouge'], ['Vegetable oil', 'litre', 'huile raffinee soja'], ['Groundnut oil', 'litre', 'huile arachide'], ['Margarine', 'kg', 'margarine'], ['Butter', 'kg', 'beurre'],
    ]),
    L('Spices & seasoning', [
      ['Salt', 'kg', 'sel'], ['Maggi cubes', 'cube', 'maggi bouillon'], ['Jumbo cubes', 'cube', 'jumbo bouillon'], ['Black pepper', 'kg', 'poivre noir'], ['Penja white pepper', 'kg', 'poivre blanc penja'],
      ['Country onion (rondelle)', 'kg', 'rondelle'], ['Mbongo spice', 'kg', 'mbongo'], ['Pèbè (African nutmeg)', 'kg', 'pebe muscade africaine'], ['Grains of paradise', 'kg', 'alligator pepper maniguette'],
      ['Achu spice', 'kg', 'achu'], ['Curry powder', 'kg', 'curry'], ['Thyme', 'sachet', 'thym'], ['Bay leaves', 'sachet', 'laurier'], ['Nutmeg', 'piece', 'muscade'], ['Cloves', 'kg', 'clou de girofle'],
      ['Dried pepper', 'kg', 'piment sec'], ['Crayfish', 'kg', 'crevettes sechees ecrevisses'], ['Tomato paste', 'tin', 'concentre de tomate'], ['Vinegar', 'litre', 'vinaigre'], ['Mustard', 'jar', 'moutarde'],
      ['Mayonnaise', 'jar', 'mayonnaise'], ['Ketchup', 'bottle', 'ketchup'], ['Sugar', 'kg', 'sucre'], ['Baking powder', 'sachet', 'levure chimique'], ['Yeast', 'sachet', 'levure boulanger'],
    ]),
    L('Meat, fish & eggs', [
      ['Beef', 'kg', 'boeuf viande'], ['Beef with bones', 'kg', 'boeuf avec os'], ['Goat meat', 'kg', 'chevre cabri'], ['Chicken, local (whole)', 'piece', 'poulet pays'], ['Chicken, broiler (whole)', 'piece', 'poulet de chair'],
      ['Chicken pieces (frozen)', 'kg', 'poulet congele cuisses'], ['Pork', 'kg', 'porc'], ['Tripe', 'kg', 'tripes'], ['Cow skin (kanda)', 'kg', 'kanda peau'], ['Sausages', 'kg', 'saucisses'],
      ['Fresh fish (bar / machoiron)', 'kg', 'poisson frais bar machoiron'], ['Tilapia', 'kg', 'tilapia carpe'], ['Mackerel (frozen)', 'kg', 'maquereau congele'], ['Smoked fish', 'kg', 'poisson fume'],
      ['Dried fish', 'kg', 'poisson seche'], ['Stockfish', 'kg', 'morue stockfish'], ['Shrimps', 'kg', 'crevettes'], ['Eggs', 'piece', 'oeufs', { name: 'tray', size: 30, default: true }],
    ]),
    L('Dairy & bakery', [
      ['Fresh milk', 'litre', 'lait frais'], ['Powdered milk', 'kg', 'lait en poudre'], ['Evaporated milk', 'tin', 'lait concentre'], ['Cheese', 'kg', 'fromage'], ['Bread (baguette)', 'piece', 'pain baguette'],
    ]),
    L('Fruits', [
      ['Lime / lemon', 'piece', 'citron'], ['Pineapple', 'piece', 'ananas'], ['Orange', 'piece', 'orange'], ['Watermelon', 'piece', 'pasteque'], ['Papaya', 'piece', 'papaye'], ['Mango', 'piece', 'mangue'], ['Banana', 'bunch', 'banane douce'],
    ]),
    L('Kitchen supplies', [
      ['Cooking gas (12.5 kg bottle)', 'bottle', 'gaz bouteille'], ['Charcoal', 'bag', 'charbon'], ['Banana leaves', 'bunch', 'feuilles de bananier koki ndomba'], ['Aluminium foil', 'roll', 'papier alu'],
      ['Takeaway boxes', 'piece', 'emballage barquette'], ['Plastic bags', 'packet', 'sachets plastiques'], ['Drinking water (for cooking)', 'litre', 'eau'],
    ]),
  );
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const items = RAW.map((x, i) => Object.assign(x, { sku: 'ING-' + String(i + 1).padStart(3, '0'), _n: norm(x.name), _q: norm(x.name + ' ' + x.aka + ' ' + x.cat) }));
  const cats = [...new Set(items.map((x) => x.cat))];
  const data = { items, categories: cats.map((c) => ({ name: c, subs: [], count: items.filter((x) => x.cat === c).length })) };
  const find = (q, cat) => { const w = norm(q).split(' ').filter(Boolean); return items.filter((x) => (!cat || x.cat === cat) && w.every((t) => x._q.includes(t))); };
  const bySku = (sku) => items.find((x) => x.sku === sku) || null;
  const byName = (name) => { const n = norm(name); return items.find((x) => x._n === n) || null; };
  const metaLine = (d) => [d.cat, 'by the ' + d.unit, d.pack ? d.pack.name + ' of ' + d.pack.size : '', d.aka ? d.aka.split(' ').slice(0, 2).join(' ') : ''].filter(Boolean).join(' · ');
  /** the stock item an ingredient becomes (stock itself comes from purchases) */
  const toProduct = (d) => ({ id: uid('pr_'), name: d.name, category: d.cat, subcategory: '', condition: 'New', barcode: '', markup: null, minMarkup: null, priceMax: null, priceMin: null, unit: d.unit, size: null, sizeUnit: '', packs: d.pack ? [{ name: d.pack.name, size: d.pack.size, price: null }] : [], ingredient: { sku: d.sku } });
  const productOf = (d) => K.raw.products.find((p) => !p.archived && p.ingredient && p.ingredient.sku === d.sku) || K.raw.products.find((p) => !p.archived && norm(p.name) === d._n) || null;
  const inStock = (d) => { const p = productOf(d); return p ? Math.max(0, Math.round(((K.C.prodX[p.id] || {}).available || 0) * 100) / 100) : 0; };
  const detail = (d) => '<div class="dk-detail"><div class="dk-kv"><span>Category</span><b>' + esc(d.cat) + '</b></div><div class="dk-kv"><span>Counted by</span><b>' + esc(d.unit) + '</b></div>' + (d.pack ? '<div class="dk-kv"><span>Bought by</span><b>' + esc(d.pack.name + ' of ' + d.pack.size) + '</b></div>' : '') + (d.aka ? '<div class="dk-note">Also called: ' + esc(d.aka) + '</div>' : '') + '</div>';
  const about = () => openSheet({ title: 'About the ingredients list', wide: true, body: '<p class="small">' + items.length + ' ingredients and kitchen supplies used in Cameroonian restaurants. Search in English or French (piment, rondelle, folong…). Anything missing: add it yourself.</p><div class="dk-legend">' + cats.map((c) => '<div><b>' + esc(c) + '</b><span>' + esc(items.filter((x) => x.cat === c).map((x) => x.name).join(', ')) + '</span></div>').join('') + '</div>', foot: '<button class="btn pri grow" data-a="sheetClose">Close</button>' });
  const src = { load: async () => data, data: () => data, find, bySku, metaLine, detail, about, noun: 'ingredient', nouns: 'ingredients', listName: 'the ingredients list', placeholder: 'Search: onion, maggi, piment, ndolè, crayfish…', icon: '🧅' };
  const picker = (opt) => Drinks.picker(Object.assign({ src }, opt));
  return { items, data, find, bySku, byName, norm, metaLine, toProduct, productOf, inStock, picker, src };
})();
