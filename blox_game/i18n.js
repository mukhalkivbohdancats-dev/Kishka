// =====================================================================
// KishkaBlox — переклади написів усередині гри (українська, російська, англійська).
// Мову передає застосунок: KishkaGame.config({ lang: 'uk' | 'ru' | 'en' }). Немає ключа — береться англійський.
// Ті самі ключі мусять бути в усіх трьох мовах (це перевіряє test/blox.test.js).
// =====================================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KishkaI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DICT = {
        uk: {
            cars: 'Машини',
            close: 'Закрити',
            select: 'Вибрати',
            selected: 'Вибрано',
            spawn: 'Створити',
            sedan: 'Автомобіль',
            van: 'Фургон',
            truck: 'Вантажівка',
            sedan_hint: 'Звичайний автомобіль: швидкий і маневрений',
            van_hint: 'Компактний фургон: просторий і стійкий',
            truck_hint: 'Повільна, але потужна',
            exit_car: 'Вийти з машини',
            enter_car: 'Сісти в машину',
            gas: 'Газ',
            reverse: 'Назад',
            left: 'Ліворуч',
            right: 'Праворуч',
            car_spawned: 'Машину створено',
            car_removed: 'Стару машину прибрано',
            car_failed: 'Не вдалося створити машину',
            car_wait: 'Зачекайте мить перед новою машиною',
            car_far: 'Підійдіть ближче до своєї машини',
            net_lost: 'Немає зв\'язку із сервером',
            net_back: 'Зв\'язок відновлено',
            cars_title: 'Оберіть машину',
            kmh: 'КМ/ГОД',
            speedometer: 'Спідометр',
            respawned: 'Ви повернулись на майданчик'
        },
        ru: {
            cars: 'Машины',
            close: 'Закрыть',
            select: 'Выбрать',
            selected: 'Выбрано',
            spawn: 'Создать',
            sedan: 'Автомобиль',
            van: 'Фургон',
            truck: 'Грузовик',
            sedan_hint: 'Обычный автомобиль: быстрый и манёвренный',
            van_hint: 'Компактный фургон: просторный и устойчивый',
            truck_hint: 'Медленный, но мощный',
            exit_car: 'Выйти из машины',
            enter_car: 'Сесть в машину',
            gas: 'Газ',
            reverse: 'Назад',
            left: 'Влево',
            right: 'Вправо',
            car_spawned: 'Машина создана',
            car_removed: 'Старая машина убрана',
            car_failed: 'Не удалось создать машину',
            car_wait: 'Подождите немного перед новой машиной',
            car_far: 'Подойдите ближе к своей машине',
            net_lost: 'Нет связи с сервером',
            net_back: 'Связь восстановлена',
            cars_title: 'Выберите машину',
            kmh: 'КМ/Ч',
            speedometer: 'Спидометр',
            respawned: 'Вы вернулись на площадку'
        },
        en: {
            cars: 'Cars',
            close: 'Close',
            select: 'Select',
            selected: 'Selected',
            spawn: 'Spawn',
            sedan: 'Car',
            van: 'Van',
            truck: 'Truck',
            sedan_hint: 'Regular car: fast and agile',
            van_hint: 'Compact van: roomy and stable',
            truck_hint: 'Slow but powerful',
            exit_car: 'Exit car',
            enter_car: 'Enter car',
            gas: 'Gas',
            reverse: 'Reverse',
            left: 'Left',
            right: 'Right',
            car_spawned: 'Car spawned',
            car_removed: 'Your old car was removed',
            car_failed: 'Could not spawn the car',
            car_wait: 'Wait a moment before spawning another car',
            car_far: 'Move closer to your car',
            net_lost: 'No connection to the server',
            net_back: 'Connection restored',
            cars_title: 'Choose a car',
            kmh: 'KM/H',
            speedometer: 'Speedometer',
            respawned: 'You returned to the platform'
        }
    };

    var lang = 'en';

    function setLang(l) {
        lang = DICT[l] ? l : 'en';
        return lang;
    }

    function t(key) {
        var d = DICT[lang];
        if (d && d[key] !== undefined) return d[key];
        return DICT.en[key] !== undefined ? DICT.en[key] : key;
    }

    return { DICT: DICT, setLang: setLang, t: t, get lang() { return lang; } };
});
