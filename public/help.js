(function () {
  var arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.6 6.4 9.1 12l5.5 5.6-1.4 1.4L6.3 12l6.9-7z"/></svg>';

  function holes() {
    var out = '';
    for (var i = 0; i < 6; i++) {
      var y = 16 + i * 26;
      out += '<rect x="16" y="' + y + '" width="10" height="14" rx="2"/>';
      out += '<rect x="614" y="' + y + '" width="10" height="14" rx="2"/>';
    }
    return out;
  }

  function scene(inner) {
    return '<svg viewBox="0 0 640 176" aria-hidden="true">' +
      '<g fill="currentColor" opacity="0.22">' + holes() + '</g>' +
      inner +
      '</svg>';
  }

  var arts = {
    dash: scene(
      '<rect x="118" y="28" width="150" height="120" rx="16" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="134" y="44" width="54" height="88" rx="8" fill="currentColor" opacity="0.2"/>' +
      '<rect x="196" y="44" width="54" height="88" rx="8" fill="currentColor" opacity="0.38"/>' +
      '<rect x="292" y="36" width="132" height="104" rx="16" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="306" y="50" width="104" height="46" rx="8" fill="currentColor" opacity="0.22"/>' +
      '<rect x="306" y="102" width="104" height="24" rx="8" fill="#3ecf8e" opacity="0.85"/>' +
      '<rect x="448" y="52" width="92" height="72" rx="14" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="494" cy="80" r="14" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M470 112c6-8 12-12 24-12s18 4 24 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    ),
    script: scene(
      '<rect x="168" y="22" width="304" height="132" rx="16" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="192" y="42" width="120" height="12" rx="6" fill="currentColor" opacity="0.85"/>' +
      '<rect x="192" y="68" width="210" height="10" rx="5" fill="#ff3d1f"/>' +
      '<rect x="192" y="88" width="168" height="10" rx="5" fill="#f5c542"/>' +
      '<rect x="192" y="108" width="230" height="10" rx="5" fill="currentColor" opacity="0.35"/>' +
      '<rect x="192" y="128" width="96" height="10" rx="5" fill="#3ecf8e"/>' +
      '<circle cx="430" cy="48" r="8" fill="#ff3d1f"/>' +
      '<circle cx="452" cy="48" r="8" fill="#f5c542"/>' +
      '<circle cx="474" cy="48" r="8" fill="#3ecf8e"/>'
    ),
    prompt: scene(
      '<rect x="132" y="24" width="376" height="128" rx="18" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="156" y="78" width="328" height="28" rx="8" fill="currentColor" opacity="0.16"/>' +
      '<rect x="176" y="46" width="250" height="8" rx="4" fill="currentColor" opacity="0.28"/>' +
      '<rect x="176" y="88" width="280" height="8" rx="4" fill="currentColor"/>' +
      '<rect x="176" y="118" width="210" height="8" rx="4" fill="currentColor" opacity="0.28"/>' +
      '<circle cx="156" cy="92" r="5" fill="#f5c542"/>'
    ),
    edit: scene(
      '<rect x="78" y="22" width="250" height="86" rx="14" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="96" y="58" width="150" height="14" rx="7" fill="currentColor" opacity="0.8"/>' +
      '<rect x="348" y="22" width="214" height="86" rx="14" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="366" y="40" width="70" height="10" rx="5" fill="currentColor" opacity="0.35"/>' +
      '<rect x="366" y="58" width="150" height="10" rx="5" fill="#f5c542"/>' +
      '<rect x="366" y="76" width="110" height="10" rx="5" fill="#3ecf8e"/>' +
      '<rect x="78" y="122" width="150" height="28" rx="8" fill="currentColor" opacity="0.75"/>' +
      '<rect x="240" y="122" width="190" height="28" rx="8" fill="#3ba0ff" opacity="0.85"/>' +
      '<rect x="442" y="122" width="120" height="28" rx="8" fill="#e85d8a" opacity="0.9"/>'
    ),
    scenarios: scene(
      '<rect x="196" y="28" width="248" height="36" rx="12" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="176" y="70" width="288" height="40" rx="12" fill="currentColor" opacity="0.16" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="156" y="116" width="328" height="40" rx="12" fill="currentColor" opacity="0.82"/>' +
      '<path d="M188 136l8 8 16-18" fill="none" stroke="#14161a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    takes: scene(
      '<rect x="132" y="36" width="376" height="104" rx="14" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="156" y="56" width="70" height="64" rx="8" fill="currentColor" opacity="0.2"/>' +
      '<rect x="238" y="56" width="70" height="64" rx="8" fill="currentColor" opacity="0.38"/>' +
      '<rect x="320" y="56" width="70" height="64" rx="8" fill="#f5c542" opacity="0.9"/>' +
      '<rect x="402" y="56" width="70" height="64" rx="8" fill="currentColor" opacity="0.2"/>' +
      '<path d="M348 78l16 10-16 10z" fill="#14161a"/>'
    ),
    settings: scene(
      '<circle cx="250" cy="88" r="36" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="250" cy="88" r="10" fill="currentColor"/>' +
      '<path d="M250 40v12M250 124v12M202 88h12M286 88h12M216 54l8 8M276 114l8 8M216 122l8-8M276 62l8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<rect x="360" y="48" width="150" height="14" rx="7" fill="currentColor" opacity="0.25"/>' +
      '<circle cx="430" cy="55" r="9" fill="currentColor"/>' +
      '<rect x="360" y="80" width="150" height="14" rx="7" fill="#3ecf8e" opacity="0.35"/>' +
      '<circle cx="470" cy="87" r="9" fill="#3ecf8e"/>' +
      '<rect x="360" y="112" width="150" height="14" rx="7" fill="currentColor" opacity="0.25"/>' +
      '<circle cx="400" cy="119" r="9" fill="#f5c542"/>'
    ),
  };

  var icons = {
    dash: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="16" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="4" width="8" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="13" width="8" height="7" rx="1.6" fill="currentColor"/></svg>',
    script: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M7 3.5h7l4 4V20.2H7z"/><path stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M9 12h6M9 15.5h4"/><circle cx="16.5" cy="8" r="1.5" fill="#e85d8a"/></svg>',
    prompt: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M6 9h12M6 12h9M6 15h7"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M4 8h16M4 12.5h16M4 17h16"/><rect x="6" y="6.2" width="6" height="3.4" rx="1" fill="currentColor"/><rect x="11" y="10.8" width="7" height="3.4" rx="1" fill="#3ecf8e"/></svg>',
    scenarios: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="9.5" width="16" height="5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6" y="15.5" width="12" height="5" rx="1.4" fill="currentColor"/></svg>',
    takes: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="currentColor" d="M5 8h2.2v2.2H5zm0 3.6h2.2V14H5zM16.8 8H19v2.2h-2.2zm0 3.6H19V14h-2.2z"/><path d="M11 9.2l4 2.8-4 2.8z" fill="currentColor"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 3.2v2.2M12 18.6V21M4.2 6.1l1.6 1.6M18.2 16.3l1.6 1.6M3.2 12h2.2M18.6 12H21M4.2 17.9l1.6-1.6M18.2 7.7l1.6-1.6"/></svg>',
  };

  var clusters = [
    [
      {
        title: 'صفحه داشبورد',
        art: 'dash',
        body: [
          'داشبورد جای شروع کاره. پیش‌نمایش، دوربین‌ها، نسبت تصویر، میکروفون و آدرس گوشی همین‌جا هستن.',
          'از همین صفحه یا با سناریو ضبط می‌کنی، یا بدون متن. تیترهای زیر، هر کدوم یه قسمت از همین صفحه‌ان.',
        ],
        items: [
          {
            title: 'ضبط از روی سناریو',
            body: [
              'دکمه‌ی «ضبط از روی سناریو» رو بزن. فهرست سناریوها باز می‌شه.',
              'تیتر یا یه تیکه از متن رو بنویس تا پیداش کنی. روی سناریو بزن تا تله‌پرامپتر با همون متن باز بشه.',
              'از همون پنجره می‌تونی «افزودن سناریو جدید» رو هم بزنی.',
            ],
          },
          {
            title: 'ضبط بدون سناریو',
            body: [
              '«ضبط بدون سناریو» متن نداره و فقط تصویر رو نشون می‌ده.',
              'یه ضبط یکسره می‌گیری، قبولش می‌کنی و می‌ری صفحه‌ی ادیت.',
            ],
          },
          {
            title: 'برش دوربین',
            body: [
              '«برش دوربین» رو بزن و «مقدار ثانیه هر برش» رو بده. سر همون مقدار، تصویر از یه دوربین می‌ره روی دوربین بعدی و ویدیو خودش برش می‌خوره.',
              'هر دوربین از اول تا آخر فقط تصویر خودش رو ضبط می‌کنه و توی ادیتور روی لاین خودش میاد. کشیدن لبه‌ی یه تکه، همون دوربین رو نشون می‌ده.',
              'ضبط‌های قبلی این فایل جدا رو ندارن و باید دوباره ضبط بشن.',
            ],
          },
          {
            title: 'چند دوربین',
            body: [
              '«چند دوربین» صفحه رو به تعداد دوربین‌های روشن تقسیم می‌کنه. هر قسمت، تصویر یه دوربینه. تا ۴ دوربین همزمان جا می‌شه.',
              'اگه نسبت تصویر مربع باشه، زیر همون دکمه‌ها «تقسیم مربع» میاد. عمودی یعنی تصویرها کنار هم، مثل ستون. افقی یعنی روی هم، مثل ردیف. این انتخاب فقط برای مربعه.',
              'تیک «اشتراک صفحه» توی بخش دوربین‌هاست. با زدنش مرورگر می‌پرسه کدوم مانیتور رو نشون بده. صفحه مثل یه دوربین دیگه کنار تصویر میاد و توی تایم‌لاین یه لاین ویدیوی بی‌صدا می‌شه. برای قطعش تیک رو بردار.',
            ],
          },
          {
            title: 'برش اتوماتیک',
            body: [
              '«برش اتوماتیک» حالت سوم دوربین‌هاست و زیر «چند دوربین» روی داشبورد نشسته. دوربین‌هایی که می‌خوای رو تیک بزن، بعد این دکمه رو روشن کن.',
              'به لنز هر دوربینی که نگاه کنی، همون دوربین تصویر اصلی می‌شه و تا وقتی به دوربین بعدی نگاه نکنی همون می‌مونه. یه نگاه گذرا برش نمی‌سازه. سر باید به سمت همون لنز بچرخه.',
              'حسگر روی همین لپ‌تاپه و به اینترنت وصل نمی‌شه. هر دوربین می‌پرسه صورت مستقیم به لنز خودش نگاه می‌کنه یا نه. دوربین‌ها باید از هم زاویه داشته باشن، مثل چپ، روبه‌رو و راست.',
              'حداقل دو دوربین باید روشن باشه، وگرنه زیر دکمه می‌نویسه «حداقل دو دوربین روشن کن». هر دوربین از اول تا آخر فایل خودش رو داره و لحظه‌های نگاه کردن توی ادیتور روی لاین همون دوربین میاد.',
            ],
          },
          {
            title: 'نسبت تصویر',
            body: [
              'سه حالت داری: عمودی برای ریل، مربع، و افقی. همون نسبت توی ضبط و خروجی می‌مونه.',
              'تقسیم عمودی یا افقی فقط وقتی دیده می‌شه که نسبت مربع باشه و «چند دوربین» روشن باشه.',
            ],
          },
          {
            title: 'افزودن دوربین گوشی',
            body: [
              'گوشی و لپ‌تاپ رو به یه وای‌فای وصل کن. آدرس شبکه رو از داشبورد کپی کن و توی مرورگر گوشی بزن.',
              'اگه هشدار امنیتی اومد، ادامه رو بزن. این هشدار به خاطر دوربین و میکروفون خودته.',
              'گوشی وصل که شد، مثل بقیه‌ی دوربین‌ها توی لیست میاد. صفحه‌ی گوشی باید بگه «داره مستقیم فرستاده می‌شه».',
            ],
          },
          {
            title: 'مدیریت دوربین‌ها',
            body: [
              'کارت «دوربین‌ها» لیست چیزهاییه که می‌تونی توی تصویر بیاری: دوربین لپ‌تاپ، گوشی، و در صورت نیاز اشتراک صفحه.',
              'تیک هر کدوم رو بزن تا روشن بشه. فلش بالا و پایین ترتیبشون رو عوض می‌کنه. حداقل یه دوربین باید روشن بمونه.',
              'دوربین اصلی و میکروفون رو از «تنظیمات»، تب «تنظیمات ضبط» هم می‌تونی انتخاب کنی. وسط ضبط، دوربین و حالت رو عوض نکن.',
            ],
          },
          {
            title: 'پیش‌نمایش',
            body: [
              'قاب «پیش‌نمایش» تصویر نهایی رو با همون نسبتی که انتخاب کردی نشون می‌ده.',
              'روی تصویر بکش تا کادر دوربین جابه‌جا بشه. اگه چند دوربین باشه، هر قسمت رو جدا می‌کشی.',
            ],
          },
          {
            title: 'حسگر وضعیت میکروفون',
            body: [
              'زیر پیش‌نمایش، نوشته‌ی «وضعیت میکروفون» و نوار صدا هست. میله‌ها با صدای میکروفون بالا و پایین می‌رن.',
              'اگه چند ثانیه صدا نیاد، یا صدا خیلی به سقف نزدیک بشه، همین‌جا معلوم می‌شه.',
            ],
          },
        ],
      },
    ],
    [
      {
        title: 'بخش سناریو',
        art: 'script',
        body: [
          'این صفحه‌ی نوشتن سناریوست، نه فهرست بایگانی. «افزودن سناریو» رو بزن. عنوان و متن رو بنویس. هر پاراگراف با یه خط خالی جدا می‌شه و هر پاراگراف یه تکه‌ی ضبط می‌شه.',
          'برای رنگی کردن یه کلمه، اول از «انتخاب رنگ» یه رنگ بردار، بعد همون تیکه رو انتخاب کن، بعد «تاکید روی انتخاب» رو بزن. برای برگردوندن رنگ، دایره بی‌رنگ رو بزن و دوباره «تاکید روی انتخاب». تو حالت تیره این دایره سفیده و تو حالت روشن مشکیِ متنه.',
          'با زدن «ثبت و ذخیره»، سناریو ذخیره می‌شه و توی فهرست می‌مونه.',
          'با توجه به اینکه این برنامه به صورت local و روی سیستم خودتان اجرا می‌شود، هیچ خطری اطلاعات و امنیت سیستم شما رو تهدید نمی‌کنند.',
        ],
      },
      {
        title: 'بخش تله‌پرامپتر',
        art: 'prompt',
        body: [
          'متن روی صفحه میاد و با سرعت خودت رد می‌شه. کندتر و تندتر، کوچک‌تر و بزرگ‌تر، ارتفاع سطر، برگشت به اول، و آینه (قرینه) اینجاست.',
          'کلمه‌های رنگی تاکیدن. اول سه ثانیه شمارش داری تا آماده شی، بعد ضبط شروع می‌شه. این صفحه روی گوشی هم باز می‌شه.',
        ],
        keys: [
          ['فاصله', 'شروع و توقف ضبط'],
          ['R', 'دوباره ضبط همین تکه'],
          ['Enter', 'قبول. اگه تکه بعدی هست می‌ره سراغش، آخرین تکه می‌ره ادیت'],
          ['بالا و پایین', 'سرعت رد شدن متن'],
          ['چپ و راست', 'اندازه‌ی متن'],
          ['Esc', 'بستن'],
        ],
      },
      {
        title: 'بخش ادیتور',
        art: 'edit',
        body: [
          'بعد از قبول ضبط میای اینجا. بالا تصویر پخش می‌شه، کنارش تنظیم زیرنویسه، پایین تایم‌لاین لاین‌هاست.',
          'چشم کنار آیکن هر لاین، نمایش همون لایه‌ست. خاموشش کنی لاین سر جاش می‌مونه، ولی از تصویر یا صدا کنار می‌ره.',
        ],
        items: [
          {
            title: 'تنظیم زیرنویس',
            body: [
              'رنگ نوشته، پوشش نوشته، اندازه، فاصله‌ی کلمات، فاصله‌ی حروف، فاصله‌ی سطرها و فونت اینجاست.',
              'هایلایت یه رنگ پشت کلمه‌ست. «پس زمینه زیرنویس» یه رنگ ثابت پشت کل عبارته. پوشش هر دو رو با نوار خودش تنظیم می‌کنی. «کلمه‌به‌کلمه» زیرنویس رو کلمه کلمه نشون می‌ده.',
              'زیرنویس رو روی تصویر بکش تا جاش عوض بشه. از دسته‌های دور کادر، اندازه‌ش عوض می‌شه. یه کلمه رو انتخاب کن و «زیرنویس بعدی» رو بزن تا از همون کلمه، بقیه بره زیرنویس بعدی.',
            ],
          },
          {
            title: 'تنظیمات نمایشگر',
            body: [
              'دکمه‌ی پخش، زمان، و «زوم پیش‌نمایش» مال همین قابه. از «اشکال» می‌تونی سریع دایره، مستطیل یا فلش بذاری.',
              'تیک «خطوط ادیت ویدیو» خط‌های جابه‌جایی تصویر رو روشن می‌کنه. ضبط «چند دوربین» با تیک روشن باز می‌شه. ضبط «برش دوربین» و «برش اتوماتیک» با تیک خاموش باز می‌شن، تا تصویر کامل بمونه. زیرنویس جداست و با برداشتن تیک از بین نمی‌ره.',
            ],
          },
          {
            title: 'تنظیمات تایم‌لاین',
            body: [
              'تایم‌لاین پایین صفحه‌ست. «درشت‌نمایی» خط‌ها رو درشت‌تر می‌کنه تا برش دقیق‌تر بشه.',
              '«خط جدید» لاین تصویر، صدا، متن یا شکل اضافه می‌کنه. «حذف خط» لاین انتخاب‌شده رو برمی‌داره.',
              'روی یه تکه‌ی ویدیو بزن تا «برش»، «حذف»، صدا و سرعت بیاد. برگشت و جلو هم بالای دکمه‌ی پخش هست.',
            ],
          },
          {
            title: 'جزئیات لاین تصویر / ویدیو',
            body: [
              'لبه‌ی چپ یا راست هر تکه رو بکش تا تصویر قبل یا بعدش هم روی همون خط بیاد. اگه می‌خوای چند ثانیه پشت‌سرهم از یه دوربین بمونه، تکه‌ی دوربین دیگه رو حذف کن و لبه‌ی تکه‌ی قبلی رو تا اونجا بکش.',
              'توی «برش دوربین» و «برش اتوماتیک» هر دوربین لاین خودشه. توی «چند دوربین» هر لاین یه دوربین رو در تمام مدت نشون می‌ده. صفحه‌ی اشتراک، یه لاین ویدیوی بی‌صداست.',
              'صدا، بی‌صدا، سرعت و سرعت ویژه مال تکه‌ی انتخاب‌شده‌ست.',
            ],
          },
          {
            title: 'جزئیات لاین صدا',
            body: [
              'صدای ضبط برنامه همیشه روی لاین صدای جدا میاد و لاین‌های ویدیو بی‌صدان.',
              'اگه یه ویدیوی صدادار از بیرون بیاری، می‌پرسه «لاین صدا جدا بشه؟». «آره» یعنی تصویر و صدا دو تا لاین جدا. «نه» یعنی هر دو روی همون یه لاین.',
            ],
          },
          {
            title: 'جزئیات لاین متن',
            body: [
              'لاین کلمه‌ها، متن زیرنویسه. روی یه کلمه بزن تا این‌ها بیاد: «ویرایش»، «افزودن کلمه»، «مکث بین زیرنویس»، «متن بدون زیرنویس»، «زیرنویس بعدی» و «حذف».',
              '«زمان‌بندی دوباره» زمان کلمه‌ها رو از نو می‌چینه.',
            ],
          },
          {
            title: 'جزئیات لاین اشکال',
            body: [
              'دایره، مستطیل یا فلش. رنگ، قطر، عرض، ارتفاع و ضخامت رو از نوار بالای تایم‌لاین تنظیم می‌کنی.',
              'شکل رو روی تصویر بکش تا جاش عوض بشه. از دکمه‌ی «اشکال» کنار پخش هم می‌تونی سریع یکی بذاری.',
            ],
          },
          {
            title: 'ذخیره کردن / خروجی گرفتن',
            body: [
              '«ثبت تغییرات» همین ویرایش رو نگه می‌داره تا بعداً از همون جا ادامه بدی.',
              '«ثبت نهایی» ویدیو رو می‌سازه و پوشه‌ش رو باز می‌کنه. بعدش «دیدن فایل» و «نمایش پوشه» میان.',
            ],
          },
        ],
      },
    ],
    [
      {
        title: 'صفحه بایگانی سناریوها',
        art: 'scenarios',
        body: [
          'فهرست سناریوها اینجاست، با دو تب «لیست» و «آرشیو».',
          'روی تیتر سناریو یا دکمه‌ی «ضبط» بزن تا بری تله‌پرامپتر. «ویرایش» صفحه‌ی نوشتن همون متن رو باز می‌کنه.',
          '«اتمام و آرشیو» سناریو رو از لیست می‌بره توی آرشیو تا صفحه شلوغ نشه. از آرشیو با «برگردان به لیست» برمی‌گرده. «حذف» پروژه‌ست و بعدش برنمی‌گرده.',
        ],
      },
      {
        title: 'صفحه بایگانی ضبط‌های قبلی',
        art: 'takes',
        body: [
          'همه‌ی ضبط‌ها اینجاست. دو تب «لیست» و «آرشیو» داره.',
          '«ویرایشگر» ویدیو رو توی ادیتور باز می‌کنه. «دیدن فایل» و «نمایش پوشه» مال خروجی‌ان.',
          '«اتمام و آرشیو» ضبط رو از لیست می‌بره توی آرشیو. «برگردان به لیست» برمی‌گردونه. «حذف» پاک می‌کنه و بعدش برنمی‌گرده.',
        ],
      },
      {
        title: 'صفحه تنظیمات',
        art: 'settings',
        body: [
          'از منوی بالا باز می‌شه و دو تب داره.',
          '«تنظیمات ضبط»: دوربین اصلی، میکروفون، نسبت تصویر، و یه پیش‌نمایش.',
          '«تنظیمات ظاهری»: حالت تیره یا روشن، و اندازه‌ی نوشته: معمولی، درشت، درشت‌تر.',
        ],
      },
    ],
  ];

  var index = document.getElementById('help-index');
  var pop = document.getElementById('help-pop');
  var popArt = document.getElementById('help-pop-art');
  var popKicker = document.getElementById('help-pop-kicker');
  var popTitle = document.getElementById('help-pop-title');
  var popBody = document.getElementById('help-pop-body');
  var popClose = document.getElementById('help-pop-x');
  var lastFocus = null;

  function fillBody(entry) {
    popBody.replaceChildren();
    (entry.body || []).forEach(function (text) {
      var p = document.createElement('p');
      p.textContent = text;
      popBody.appendChild(p);
    });
    if (entry.keys && entry.keys.length) {
      var list = document.createElement('ul');
      list.className = 'help-keys';
      entry.keys.forEach(function (pair) {
        var li = document.createElement('li');
        var kbd = document.createElement('kbd');
        kbd.textContent = pair[0];
        var span = document.createElement('span');
        span.textContent = pair[1];
        li.appendChild(kbd);
        li.appendChild(span);
        list.appendChild(li);
      });
      popBody.appendChild(list);
    }
  }

  function openHelp(entry, parentTitle) {
    lastFocus = document.activeElement;
    popTitle.textContent = entry.title;
    if (parentTitle) {
      popKicker.hidden = false;
      popKicker.textContent = parentTitle;
    } else {
      popKicker.hidden = true;
      popKicker.textContent = '';
    }
    popArt.innerHTML = arts[entry.art] || arts.dash;
    fillBody(entry);
    pop.hidden = false;
    document.body.classList.add('help-lock');
    popClose.focus();
  }

  function closeHelp() {
    pop.hidden = true;
    document.body.classList.remove('help-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function makeButton(className, entry, parent) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.addEventListener('click', function () {
      openHelp(entry, parent ? parent.title : '');
    });
    return btn;
  }

  clusters.forEach(function (group, groupIndex) {
    if (groupIndex) {
      var cut = document.createElement('div');
      cut.className = 'help-cut';
      cut.setAttribute('aria-hidden', 'true');
      cut.appendChild(document.createElement('span'));
      index.appendChild(cut);
    }
    group.forEach(function (section) {
      section.art = section.art || 'dash';
      var card = document.createElement('section');
      card.className = 'help-card';
      var main = makeButton('help-main', section, null);
      var ico = document.createElement('span');
      ico.className = 'help-ico';
      ico.innerHTML = icons[section.art] || icons.dash;
      var copy = document.createElement('span');
      copy.className = 'help-main-copy';
      var title = document.createElement('strong');
      title.textContent = section.title;
      copy.appendChild(title);
      var go = document.createElement('span');
      go.className = 'help-go';
      go.innerHTML = arrow;
      main.appendChild(ico);
      main.appendChild(copy);
      main.appendChild(go);
      card.appendChild(main);
      if (section.items && section.items.length) {
        var sub = document.createElement('div');
        sub.className = 'help-sub';
        section.items.forEach(function (item) {
          item.art = section.art;
          var btn = makeButton('', item, section);
          var label = document.createElement('span');
          label.textContent = item.title;
          var mark = document.createElement('span');
          mark.innerHTML = arrow;
          btn.appendChild(label);
          btn.appendChild(mark);
          sub.appendChild(btn);
        });
        card.appendChild(sub);
      }
      index.appendChild(card);
    });
  });

  popClose.addEventListener('click', closeHelp);
  pop.addEventListener('click', function (event) {
    if (event.target === pop) closeHelp();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !pop.hidden) {
      event.preventDefault();
      closeHelp();
    }
  });
})();
