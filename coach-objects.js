// COCO labels supported by our EfficientDet model. Scores stay internal.
const LABELS = {
  person: 'Человек', bicycle: 'Велосипед', car: 'Автомобиль', motorcycle: 'Мотоцикл', airplane: 'Самолёт', bus: 'Автобус', train: 'Поезд', truck: 'Грузовик', boat: 'Лодка',
  'traffic light': 'Светофор', 'fire hydrant': 'Гидрант', 'stop sign': 'Знак стоп', 'parking meter': 'Паркомат', bench: 'Скамейка', bird: 'Птица', cat: 'Кошка', dog: 'Собака', horse: 'Лошадь', sheep: 'Овца', cow: 'Корова', elephant: 'Слон', bear: 'Медведь', zebra: 'Зебра', giraffe: 'Жираф',
  backpack: 'Рюкзак', umbrella: 'Зонт', handbag: 'Сумка', tie: 'Галстук', suitcase: 'Чемодан', frisbee: 'Фрисби', skis: 'Лыжи', snowboard: 'Сноуборд', 'sports ball': 'Мяч', kite: 'Воздушный змей', 'baseball bat': 'Бита', 'baseball glove': 'Бейсбольная перчатка', skateboard: 'Скейтборд', surfboard: 'Доска для сёрфинга', 'tennis racket': 'Ракетка',
  bottle: 'Бутылка', 'wine glass': 'Бокал', cup: 'Чашка', fork: 'Вилка', knife: 'Нож', spoon: 'Ложка', bowl: 'Миска', banana: 'Банан', apple: 'Яблоко', sandwich: 'Сэндвич', orange: 'Апельсин', broccoli: 'Брокколи', carrot: 'Морковь', 'hot dog': 'Хот-дог', pizza: 'Пицца', donut: 'Пончик', cake: 'Торт',
  chair: 'Стул', couch: 'Диван', 'potted plant': 'Растение', bed: 'Кровать', 'dining table': 'Стол', toilet: 'Унитаз', tv: 'Телевизор', laptop: 'Ноутбук', mouse: 'Мышь', remote: 'Пульт', keyboard: 'Клавиатура', 'cell phone': 'Телефон', microwave: 'Микроволновка', oven: 'Духовка', toaster: 'Тостер', sink: 'Раковина', refrigerator: 'Холодильник', book: 'Книга', clock: 'Часы', vase: 'Ваза', scissors: 'Ножницы', 'teddy bear': 'Игрушечный медведь', 'hair drier': 'Фен', toothbrush: 'Зубная щётка',
};
const clamp = value => Math.max(0, Math.min(1, value));

export function normalizeObjects(detections, width, height) {
  if (!Array.isArray(detections) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  return detections.flatMap(d => {
    const b = d?.boundingBox;
    const category = Array.isArray(d?.categories) ? d.categories.filter(c => c && Object.hasOwn(LABELS, c.categoryName) && Number.isFinite(c.score)).sort((a, b) => b.score - a.score)[0] : null;
    if (!b || !category || category.score < .3 || category.score > 1 || ![b.originX, b.originY, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return [];
    const left = clamp(b.originX / width), top = clamp(b.originY / height);
    const right = clamp((b.originX + b.width) / width), bottom = clamp((b.originY + b.height) / height);
    if (right <= left || bottom <= top) return [];
    return [{ category: category.categoryName, label: LABELS[category.categoryName], x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top, score: category.score }];
  }).slice(0, 15);
}

export function ballDetections(objects) {
  return objects.filter(o => o.category === 'sports ball').map(({ x, y, w, h, score }) => ({ x, y, w, h, score }));
}
