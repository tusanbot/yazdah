-- Group mini-games, group-only currency, draft pools and group missions.
-- All writes are service-role RPCs; client code never mutates balances or game state directly.

create table if not exists public.group_economies (
  telegram_chat_id bigint primary key references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  treasury_balance bigint not null default 100000 check (treasury_balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_wallets (
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  user_id uuid not null references public.game_users(id) on delete cascade,
  balance bigint not null default 1000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (telegram_chat_id,user_id)
);

create table if not exists public.group_currency_transactions (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  user_id uuid not null references public.game_users(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id,idempotency_key)
);
create index if not exists group_currency_transactions_recent_idx
  on public.group_currency_transactions(telegram_chat_id,user_id,created_at desc);

create table if not exists public.group_legend_cards (
  id text primary key,
  full_name text not null,
  position_group text not null check (position_group in ('goalkeeper','defender','midfielder','attacker')),
  overall integer not null check (overall between 1 and 100),
  rarity text not null check (rarity in ('legend','mythic')),
  nationality text not null,
  clues jsonb not null default '[]'::jsonb
);

insert into public.group_legend_cards(id,full_name,position_group,overall,rarity,nationality,clues) values
('gk-yashin','لو یاشین','goalkeeper',99,'mythic','روسیه','["دروازه‌بان افسانه‌ای","تنها دروازه‌بان برنده توپ طلا","لقب عنکبوت سیاه"]'),
('gk-buffon','جان‌لوئیجی بوفون','goalkeeper',98,'legend','ایتالیا','["دروازه‌بان ایتالیایی","قهرمان جام جهانی ۲۰۰۶","سال‌ها در یوونتوس بازی کرد"]'),
('gk-casillas','ایکر کاسیاس','goalkeeper',97,'legend','اسپانیا','["کاپیتان نسل طلایی اسپانیا","قهرمان جام جهانی ۲۰۱۰","دروازه‌بان رئال مادرید"]'),
('gk-neuer','مانوئل نویر','goalkeeper',97,'legend','آلمان','["دروازه‌بان آلمانی","قهرمان جام جهانی ۲۰۱۴","از پیشگامان دروازه‌بان بازی‌ساز"]'),
('gk-schmeichel','پیتر اشمایکل','goalkeeper',96,'legend','دانمارک','["دروازه‌بان دانمارکی","قهرمان یورو ۱۹۹۲","اسطوره منچستریونایتد"]'),
('gk-kahn','الیور کان','goalkeeper',96,'legend','آلمان','["دروازه‌بان آلمانی","لقب تایتان","در جام جهانی ۲۰۰۲ بهترین بازیکن شد"]'),
('gk-banks','گوردون بنکس','goalkeeper',96,'legend','انگلستان','["قهرمان جام جهانی ۱۹۶۶","مهار معروف ضربه پله","دروازه‌بان انگلیسی"]'),
('gk-zoff','دینو زوف','goalkeeper',95,'legend','ایتالیا','["کاپیتان قهرمان جام جهانی ۱۹۸۲","دروازه‌بان ایتالیایی","در ۴۰ سالگی قهرمان جهان شد"]'),
('gk-vandersar','ادوین فن‌درسار','goalkeeper',94,'legend','هلند','["دروازه‌بان هلندی","در آژاکس و منچستریونایتد درخشید","قهرمان اروپا"]'),
('gk-cech','پتر چک','goalkeeper',94,'legend','جمهوری چک','["دروازه‌بان اهل جمهوری چک","اسطوره چلسی","با کلاه محافظ شناخته می‌شود"]'),
('def-maldini','پائولو مالدینی','defender',99,'mythic','ایتالیا','["مدافع چپ و میانی","اسطوره میلان","پنج بار قهرمان اروپا"]'),
('def-beckenbauer','فرانتس بکن‌باوئر','defender',99,'mythic','آلمان','["لقب قیصر","مدافع و کاپیتان آلمان","قهرمان جام جهانی هم به‌عنوان بازیکن و هم مربی"]'),
('def-baresi','فرانکو بارزی','defender',98,'mythic','ایتالیا','["مدافع میانی میلان","کاپیتان تاریخی میلان","قهرمان سه دوره اروپا"]'),
('def-cafu','کافو','defender',97,'legend','برزیل','["مدافع راست برزیلی","دو بار قهرمان جام جهانی","کاپیتان قهرمان ۲۰۰۲"]'),
('def-roberto-carlos','روبرتو کارلوس','defender',97,'legend','برزیل','["مدافع چپ برزیلی","ضربات آزاد قدرتمند","قهرمان جام جهانی ۲۰۰۲"]'),
('def-nesta','الساندرو نستا','defender',96,'legend','ایتالیا','["مدافع میانی ایتالیایی","اسطوره لاتزیو و میلان","قهرمان جام جهانی ۲۰۰۶"]'),
('def-cannavaro','فابیو کاناوارو','defender',96,'legend','ایتالیا','["مدافع ایتالیایی","برنده توپ طلا ۲۰۰۶","کاپیتان قهرمان جهان"]'),
('def-ramos','سرخیو راموس','defender',96,'legend','اسپانیا','["مدافع اسپانیایی","گلزن در فینال لیگ قهرمانان","قهرمان جام جهانی ۲۰۱۰"]'),
('def-puyol','کارلس پویول','defender',95,'legend','اسپانیا','["کاپیتان بارسلونا","مدافع جنگنده","قهرمان جام جهانی ۲۰۱۰"]'),
('def-lahm','فیلیپ لام','defender',95,'legend','آلمان','["مدافع راست و چپ","کاپیتان قهرمان جام جهانی ۲۰۱۴","نماد بازی‌خوانی"]'),
('mid-zidane','زین‌الدین زیدان','midfielder',99,'mythic','فرانسه','["هافبک فرانسوی","قهرمان جام جهانی ۱۹۹۸","برنده توپ طلا ۱۹۹۸"]'),
('mid-maradona','دیگو مارادونا','midfielder',100,'mythic','آرژانتین','["اسطوره آرژانتین","قهرمان جام جهانی ۱۹۸۶","دست خدا و گل قرن"]'),
('mid-cruyff','یوهان کرایف','midfielder',99,'mythic','هلند','["معمار فوتبال totaal","اسطوره آژاکس و بارسلونا","سه توپ طلا"]'),
('mid-xavi','ژاوی هرناندز','midfielder',97,'legend','اسپانیا','["هافبک بارسلونا","مغز متفکر تیکی‌تاکا","قهرمان جام جهانی ۲۰۱۰"]'),
('mid-iniesta','آندرس اینیستا','midfielder',98,'legend','اسپانیا','["زننده گل فینال جام جهانی ۲۰۱۰","هافبک بارسلونا","قهرمان اروپا"]'),
('mid-pirlo','آندره‌آ پیرلو','midfielder',96,'legend','ایتالیا','["هافبک بازی‌ساز ایتالیایی","متخصص ضربات ایستگاهی","قهرمان جام جهانی ۲۰۰۶"]'),
('mid-platini','میشل پلاتینی','midfielder',97,'legend','فرانسه','["هافبک فرانسوی","سه توپ طلای پیاپی","قهرمان یورو ۱۹۸۴"]'),
('mid-ronaldinho','رونالدینیو','midfielder',98,'mythic','برزیل','["جادوگر برزیلی","برنده توپ طلا ۲۰۰۵","اسطوره بارسلونا"]'),
('mid-modric','لوکا مودریچ','midfielder',96,'legend','کرواسی','["هافبک کروات","برنده توپ طلا ۲۰۱۸","نایب‌قهرمان جام جهانی ۲۰۱۸"]'),
('mid-gerrard','استیون جرارد','midfielder',95,'legend','انگلستان','["کاپیتان لیورپول","قهرمان معجزه استانبول","هافبک انگلیسی"]'),
('att-pele','پله','attacker',100,'mythic','برزیل','["سه بار قهرمان جام جهانی","ملقب به پادشاه فوتبال","اسطوره برزیل"]'),
('att-messi','لیونل مسی','attacker',100,'mythic','آرژانتین','["قهرمان جام جهانی ۲۰۲۲","هشت توپ طلا","اسطوره بارسلونا"]'),
('att-cristiano','کریستیانو رونالدو','attacker',100,'mythic','پرتغال','["پنج قهرمانی لیگ قهرمانان","قهرمان یورو ۲۰۱۶","بهترین گلزن تاریخ لیگ قهرمانان"]'),
('att-ronaldo','رونالدو نازاریو','attacker',99,'mythic','برزیل','["لقب پدیده","دو بار قهرمان جام جهانی","دو توپ طلا"]'),
('att-henry','تیری آنری','attacker',97,'legend','فرانسه','["مهاجم فرانسوی","اسطوره آرسنال","قهرمان جام جهانی ۱۹۹۸"]'),
('att-vanbasten','مارکو فان‌باستن','attacker',97,'legend','هلند','["مهاجم هلندی","سه توپ طلا","گل والی معروف در فینال یورو ۱۹۸۸"]'),
('att-eusebio','اوزه‌بیو','attacker',97,'legend','پرتغال','["پلنگ موزامبیکی","اسطوره بنفیکا","برنده توپ طلا ۱۹۶۵"]'),
('att-muller','گرد مولر','attacker',97,'legend','آلمان','["بمب‌افکن ملت","قهرمان جام جهانی ۱۹۷۴","گلزن افسانه‌ای بایرن"]'),
('att-best','جورج بست','attacker',96,'legend','ایرلند شمالی','["اسطوره منچستریونایتد","برنده توپ طلا ۱۹۶۸","وینگر تکنیکی"]'),
('att-distefano','آلفردو دی‌استفانو','attacker',98,'mythic','آرژانتین/اسپانیا','["اسطوره رئال مادرید","پنج قهرمانی پیاپی اروپا","دو توپ طلا"]')
on conflict (id) do nothing;

create table if not exists public.group_quiz_questions (
  id text primary key,
  category text not null,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
  correct_index integer not null check (correct_index between 0 and 3),
  explanation text not null
);
insert into public.group_quiz_questions(id,category,prompt,options,correct_index,explanation) values
('q-world-2010','جام جهانی','قهرمان جام جهانی ۲۰۱۰ کدام کشور بود؟','["اسپانیا","هلند","آلمان","برزیل"]',0,'اسپانیا در فینال هلند را شکست داد.'),
('q-world-2014','جام جهانی','جام جهانی ۲۰۱۴ در کدام کشور برگزار شد؟','["آفریقای جنوبی","برزیل","روسیه","آلمان"]',1,'میزبان جام جهانی ۲۰۱۴ برزیل بود.'),
('q-world-2002','جام جهانی','کدام کشور قهرمان جام جهانی ۲۰۰۲ شد؟','["آلمان","آرژانتین","برزیل","ایتالیا"]',2,'برزیل با پیروزی برابر آلمان قهرمان شد.'),
('q-ucl','اروپا','کدام تیم بیشترین قهرمانی لیگ قهرمانان اروپا را دارد؟','["میلان","رئال مادرید","بایرن مونیخ","لیورپول"]',1,'رئال مادرید رکورددار قهرمانی این رقابت است.'),
('q-euro','اروپا','قهرمان یورو ۲۰۱۶ کدام کشور بود؟','["فرانسه","آلمان","پرتغال","اسپانیا"]',2,'پرتغال در فینال فرانسه را شکست داد.'),
('q-ballon','جوایز','اولین بازیکن برنده توپ طلای تاریخ چه کسی بود؟','["استنلی متیوز","دیگو مارادونا","پله","یوهان کرایف"]',0,'استنلی متیوز در سال ۱۹۵۶ برنده شد.'),
('q-barca','باشگاه‌ها','لقب باشگاه بارسلونا چیست؟','["روسونری","بلانکوس","بلوگرانا","قرمزها"]',2,'بلوگرانا به رنگ‌های آبی و اناری اشاره دارد.'),
('q-argentina','ملی','آرژانتین در جام جهانی ۱۹۸۶ با کاپیتانی چه کسی قهرمان شد؟','["مسی","مارادونا","باتیستوتا","کمیپس"]',1,'دیگو مارادونا کاپیتان آرژانتین بود.'),
('q-italy','ملی','ایتالیا در فینال جام جهانی ۲۰۰۶ کدام تیم را شکست داد؟','["فرانسه","آلمان","برزیل","پرتغال"]',0,'ایتالیا در ضربات پنالتی فرانسه را برد.'),
('q-premier','انگلستان','کدام تیم فصل بدون شکست لیگ برتر انگلیس را در ۲۰۰۳-۰۴ ثبت کرد؟','["چلسی","منچستریونایتد","آرسنال","لیورپول"]',2,'آرسنال با لقب شکست‌ناپذیرها قهرمان شد.'),
('q-brazil','ملی','لقب تیم ملی برزیل چیست؟','["سه‌شیرها","سلسائو","آتزوری","خروس‌ها"]',1,'سلسائو به تیم ملی برزیل گفته می‌شود.'),
('q-ajax','باشگاه‌ها','یوهان کرایف بیشتر با کدام باشگاه هلندی شناخته می‌شود؟','["فاینورد","پی‌اس‌وی","آژاکس","آیندهوون"]',2,'کرایف اسطوره آژاکس است.')
on conflict (id) do nothing;

insert into public.group_quiz_questions(id,category,prompt,options,correct_index,explanation) values
('q-world-1998','جام جهانی','قهرمان جام جهانی ۱۹۹۸ کدام کشور بود؟','["برزیل","فرانسه","کرواسی","هلند"]',1,'فرانسه در فینال برزیل را شکست داد.'),
('q-world-1994','جام جهانی','قهرمان جام جهانی ۱۹۹۴ کدام کشور بود؟','["برزیل","ایتالیا","سوئد","بلغارستان"]',0,'برزیل در ضربات پنالتی فینال ایتالیا را شکست داد.'),
('q-world-2018','جام جهانی','قهرمان جام جهانی ۲۰۱۸ کدام کشور بود؟','["کرواسی","بلژیک","فرانسه","انگلیس"]',2,'فرانسه در فینال کرواسی را شکست داد.'),
('q-world-2022','جام جهانی','قهرمان جام جهانی ۲۰۲۲ کدام کشور بود؟','["فرانسه","برزیل","کرواسی","آرژانتین"]',3,'آرژانتین در ضربات پنالتی فرانسه را شکست داد.'),
('q-world-1966','جام جهانی','قهرمان جام جهانی ۱۹۶۶ کدام کشور بود؟','["انگلیس","آلمان غربی","پرتغال","برزیل"]',0,'انگلیس در فینال آلمان غربی را شکست داد.'),
('q-world-1970','جام جهانی','قهرمان جام جهانی ۱۹۷۰ کدام کشور بود؟','["ایتالیا","برزیل","اروگوئه","آلمان غربی"]',1,'برزیل با تیمی درخشان قهرمان شد.'),
('q-world-1982','جام جهانی','قهرمان جام جهانی ۱۹۸۲ کدام کشور بود؟','["آلمان غربی","برزیل","ایتالیا","فرانسه"]',2,'ایتالیا در فینال آلمان غربی را شکست داد.'),
('q-world-1990','جام جهانی','قهرمان جام جهانی ۱۹۹۰ کدام کشور بود؟','["آرژانتین","ایتالیا","برزیل","آلمان غربی"]',3,'آلمان غربی در فینال آرژانتین را شکست داد.'),
('q-world-2010-final','جام جهانی','گل قهرمانی فینال جام جهانی ۲۰۱۰ را چه کسی زد؟','["ژاوی","آندرس اینیستا","داوید ویا","فرناندو تورس"]',1,'اینیستا در وقت اضافه برابر هلند گل زد.'),
('q-world-1986','جام جهانی','گل معروف «دست خدا» در جام جهانی ۱۹۸۶ مقابل کدام تیم زده شد؟','["بلژیک","آلمان غربی","انگلیس","ایتالیا"]',2,'مارادونا این گل را مقابل انگلیس به ثمر رساند.'),
('q-euro-2004','یورو','قهرمان یورو ۲۰۰۴ کدام کشور بود؟','["پرتغال","ایتالیا","فرانسه","یونان"]',3,'یونان در فینال پرتغال را شکست داد.'),
('q-euro-2008','یورو','قهرمان یورو ۲۰۰۸ کدام کشور بود؟','["اسپانیا","آلمان","روسیه","ترکیه"]',0,'اسپانیا با گل فرناندو تورس آلمان را برد.'),
('q-euro-2012','یورو','قهرمان یورو ۲۰۱۲ کدام کشور بود؟','["ایتالیا","اسپانیا","آلمان","پرتغال"]',1,'اسپانیا در فینال ایتالیا را چهار بر صفر شکست داد.'),
('q-euro-2020','یورو','قهرمان یورو ۲۰۲۰ کدام کشور بود؟','["انگلیس","فرانسه","ایتالیا","دانمارک"]',2,'ایتالیا در ضربات پنالتی انگلیس را شکست داد.'),
('q-euro-2024','یورو','قهرمان یورو ۲۰۲۴ کدام کشور بود؟','["انگلیس","فرانسه","آلمان","اسپانیا"]',3,'اسپانیا در فینال انگلیس را شکست داد.'),
('q-ucl-2005','اروپا','قهرمان لیگ قهرمانان اروپا در فینال معروف استانبول ۲۰۰۵ کدام تیم بود؟','["میلان","لیورپول","چلسی","بارسلونا"]',1,'لیورپول پس از بازگشت تاریخی در ضربات پنالتی پیروز شد.'),
('q-ucl-2012','اروپا','کدام تیم در سال ۲۰۱۲ برای نخستین بار قهرمان لیگ قهرمانان اروپا شد؟','["بایرن مونیخ","بارسلونا","چلسی","رئال مادرید"]',2,'چلسی در فینال بایرن مونیخ را در ضربات پنالتی شکست داد.'),
('q-ucl-2013','اروپا','قهرمان لیگ قهرمانان اروپا در سال ۲۰۱۳ کدام تیم بود؟','["بایرن مونیخ","دورتموند","رئال مادرید","منچستریونایتد"]',0,'بایرن مونیخ در فینال دورتموند را شکست داد.'),
('q-ucl-1999','اروپا','کدام تیم در فینال لیگ قهرمانان ۱۹۹۹ در وقت اضافه قهرمان شد؟','["یوونتوس","بارسلونا","آژاکس","منچستریونایتد"]',3,'منچستریونایتد با دو گل دیرهنگام بایرن را شکست داد.'),
('q-copa-2021','ملی','قهرمان کوپا آمریکا ۲۰۲۱ کدام کشور بود؟','["آرژانتین","برزیل","اروگوئه","کلمبیا"]',0,'آرژانتین در فینال برزیل را شکست داد.')
on conflict (id) do nothing;

create table if not exists public.group_games (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  game_type text not null check (game_type in ('draft','penalty','cards','quiz','guess','survival')),
  title text not null,
  created_by_user_id uuid not null references public.game_users(id),
  entry_fee bigint not null default 0 check (entry_fee between 0 and 1000000),
  prize_pool bigint not null default 0 check (prize_pool >= 0),
  max_participants integer not null default 2 check (max_participants between 2 and 30),
  status text not null default 'open' check (status in ('open','active','completed','cancelled')),
  settings jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  current_round integer not null default 0,
  deadline_at timestamptz,
  winner_user_id uuid references public.game_users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists group_games_chat_open_idx on public.group_games(telegram_chat_id,status,created_at desc);

create table if not exists public.group_game_participants (
  game_id uuid not null references public.group_games(id) on delete cascade,
  user_id uuid not null references public.game_users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  formation text not null default '1-2-1' check (formation in ('1-1-2','1-2-1','2-1-1','2-2')),
  score integer not null default 0,
  status text not null default 'active' check (status in ('active','eliminated','winner','completed')),
  picks jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  primary key(game_id,user_id)
);

create table if not exists public.group_mission_definitions (
  id text primary key,
  title text not null,
  description text not null,
  cadence text not null check (cadence in ('daily','weekly','monthly','collective')),
  scope text not null check (scope in ('member','group')),
  event_type text not null,
  target_count integer not null check (target_count between 1 and 10000),
  reward_coins bigint not null check (reward_coins > 0),
  active boolean not null default true
);
create table if not exists public.group_mission_progress (
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  mission_id text not null references public.group_mission_definitions(id) on delete cascade,
  period_key text not null,
  subject_key text not null,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(telegram_chat_id,mission_id,period_key,subject_key)
);
create table if not exists public.group_mission_events (
  event_key text primary key,
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  user_id uuid references public.game_users(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

insert into public.group_mission_definitions(id,title,description,cadence,scope,event_type,target_count,reward_coins) values
('daily-join','حضور روزانه','در یک چالش گروهی شرکت کن','daily','member','game_joined',1,100),
('daily-play','رقابت روزانه','یک چالش را به پایان برسان','daily','member','game_completed',1,250),
('daily-win','برنده روز','یک چالش گروهی را ببر','daily','member','game_won',1,400),
('weekly-three','رقیب هفته','سه چالش را به پایان برسان','weekly','member','game_completed',3,900),
('weekly-win','قهرمان هفته','سه پیروزی در چالش‌ها کسب کن','weekly','member','game_won',3,1500),
('weekly-quiz','دانش فوتبالی','پنج پاسخ صحیح در رقابت‌های دانشی ثبت کن','weekly','member','quiz_correct',5,700),
('monthly-active','عضو فعال ماه','در ده چالش شرکت کن','monthly','member','game_joined',10,2500),
('monthly-survivor','بازمانده ماه','در سه چالش بقا تا پایان زنده بمان','monthly','member','survival_survived',3,3000),
('group-activity','گروه پرجنب‌وجوش','اعضای گروه در مجموع ۲۰ چالش را تمام کنند','collective','group','game_completed',20,5000),
('group-united','اتحاد گروه','حداقل ۳۰ بار اعضا در چالش‌ها شرکت کنند','collective','group','game_joined',30,7000)
on conflict(id) do nothing;
update public.group_mission_definitions set event_type='group_game_completed' where id='group-activity';

create or replace function public.ensure_group_economy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.group_economies(telegram_chat_id) values(new.telegram_chat_id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists telegram_group_create_economy on public.telegram_game_groups;
create trigger telegram_group_create_economy after insert on public.telegram_game_groups
for each row execute function public.ensure_group_economy();
insert into public.group_economies(telegram_chat_id)
select telegram_chat_id from public.telegram_game_groups on conflict do nothing;

create or replace function public.group_wallet_change(
  p_chat_id bigint,p_user_id uuid,p_amount bigint,p_reason text,p_idempotency_key text
) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v_balance bigint; v_existing bigint;
begin
  select balance_after into v_existing from public.group_currency_transactions
  where telegram_chat_id=p_chat_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;
  insert into public.group_wallets(telegram_chat_id,user_id,balance)
  values(p_chat_id,p_user_id,1000) on conflict do nothing;
  select balance into v_balance from public.group_wallets
  where telegram_chat_id=p_chat_id and user_id=p_user_id for update;
  if v_balance+p_amount<0 then raise exception 'group_wallet_insufficient' using errcode='22023'; end if;
  v_balance:=v_balance+p_amount;
  update public.group_wallets set balance=v_balance,updated_at=now()
  where telegram_chat_id=p_chat_id and user_id=p_user_id;
  insert into public.group_currency_transactions(telegram_chat_id,user_id,amount,balance_after,reason,idempotency_key)
  values(p_chat_id,p_user_id,p_amount,p_reason,p_idempotency_key);
  return v_balance;
end;
$$;

create or replace function public.record_group_mission_event(
  p_chat_id bigint,p_user_id uuid,p_event_type text,p_event_key text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m record; v_period text; v_subject text;
begin
  insert into public.group_mission_events(event_key,telegram_chat_id,user_id,event_type)
  values(p_event_key,p_chat_id,p_user_id,p_event_type) on conflict do nothing;
  if not found then return; end if;
  for m in select * from public.group_mission_definitions where active and event_type=p_event_type loop
    v_period:=case m.cadence
      when 'daily' then to_char(now() at time zone 'Asia/Tehran','YYYY-MM-DD')
      when 'weekly' then to_char(date_trunc('week',now() at time zone 'Asia/Tehran'),'YYYY-MM-DD')
      when 'monthly' then to_char(now() at time zone 'Asia/Tehran','YYYY-MM')
      else 'all-time' end;
    v_subject:=case when m.scope='group' then 'group' else p_user_id::text end;
    insert into public.group_mission_progress(telegram_chat_id,mission_id,period_key,subject_key,progress)
    values(p_chat_id,m.id,v_period,v_subject,1)
    on conflict(telegram_chat_id,mission_id,period_key,subject_key) do update
      set progress=public.group_mission_progress.progress+1,updated_at=now()
      where public.group_mission_progress.claimed_at is null;
  end loop;
end;
$$;

create or replace function public.create_group_game(
  p_chat_id bigint,p_creator_user_id uuid,p_game_type text,p_entry_fee bigint,p_max_participants integer,p_title text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_max integer;
begin
  if p_game_type not in ('draft','penalty','cards','quiz','guess','survival')
     or p_entry_fee<0 or p_entry_fee>1000000 then
    raise exception 'group_game_input_invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.telegram_game_groups where telegram_chat_id=p_chat_id) then
    raise exception 'telegram_group_not_linked' using errcode='P0002';
  end if;
  v_max:=greatest(2,least(coalesce(p_max_participants,2),30));
  if p_game_type in ('draft','penalty','cards') then v_max:=2; end if;
  insert into public.group_games(telegram_chat_id,game_type,title,created_by_user_id,entry_fee,max_participants,prize_pool)
  values(p_chat_id,p_game_type,coalesce(nullif(trim(p_title),''),case p_game_type
    when 'draft' then 'چالش درفت' when 'penalty' then 'چالش پنالتی' when 'cards' then 'چالش کارت بازی'
    when 'quiz' then 'چالش اطلاعات فوتبالی' when 'guess' then 'چالش حدس بازیکن' else 'چالش بقا' end),
    p_creator_user_id,p_entry_fee,v_max,0)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.join_group_game(
  p_game_id uuid,p_user_id uuid,p_club_id uuid,p_formation text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.group_games%rowtype; v_count integer; v_balance bigint;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found then raise exception 'group_game_not_found' using errcode='P0002'; end if;
  if g.status<>'open' then raise exception 'group_game_not_open' using errcode='22023'; end if;
  if p_formation not in ('1-1-2','1-2-1','2-1-1','2-2') then raise exception 'group_formation_invalid' using errcode='22023'; end if;
  if exists(select 1 from public.group_game_participants where game_id=p_game_id and user_id=p_user_id) then
    raise exception 'group_game_already_joined' using errcode='23505';
  end if;
  select count(*) into v_count from public.group_game_participants where game_id=p_game_id;
  if v_count>=g.max_participants then raise exception 'group_game_full' using errcode='22023'; end if;
  if not exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=p_user_id and role='owner') then
    raise exception 'group_game_club_not_owned' using errcode='42501';
  end if;
  if g.entry_fee>0 then
    v_balance:=public.group_wallet_change(g.telegram_chat_id,p_user_id,-g.entry_fee,'challenge_entry',g.id::text||':entry:'||p_user_id::text);
    update public.group_games set prize_pool=prize_pool+g.entry_fee where id=p_game_id;
  else
    insert into public.group_wallets(telegram_chat_id,user_id,balance) values(g.telegram_chat_id,p_user_id,1000) on conflict do nothing;
    select balance into v_balance from public.group_wallets where telegram_chat_id=g.telegram_chat_id and user_id=p_user_id;
  end if;
  insert into public.group_game_participants(game_id,user_id,club_id,formation) values(p_game_id,p_user_id,p_club_id,p_formation);
  perform public.record_group_mission_event(g.telegram_chat_id,p_user_id,'game_joined','join:'||p_game_id||':'||p_user_id);
  return jsonb_build_object('joined',true,'balance',v_balance,'prizePool',g.prize_pool+g.entry_fee);
end;
$$;

create or replace function public.start_group_game(p_game_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.group_games%rowtype; v_users uuid[]; v_first uuid; v_state jsonb; v_pool jsonb; v_questions jsonb; v_hands jsonb; v_cards jsonb;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found then raise exception 'group_game_not_found' using errcode='P0002'; end if;
  if g.created_by_user_id<>p_actor_user_id then raise exception 'group_game_creator_required' using errcode='42501'; end if;
  if g.status<>'open' then raise exception 'group_game_not_open' using errcode='22023'; end if;
  select array_agg(user_id order by joined_at) into v_users from public.group_game_participants where game_id=p_game_id;
  if coalesce(array_length(v_users,1),0)<2 then raise exception 'group_game_needs_two_players' using errcode='22023'; end if;
  if g.game_type in ('draft','penalty','cards') and array_length(v_users,1)<>2 then raise exception 'group_game_needs_two_players' using errcode='22023'; end if;
  v_first:=v_users[1+floor(random()*array_length(v_users,1))::int];
  if g.game_type='draft' then
    select jsonb_build_object(
      'goalkeeper',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='goalkeeper' order by random() limit 10) x),
      'defender',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='defender' order by random() limit 10) x),
      'midfielder',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='midfielder' order by random() limit 10) x),
      'attacker',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='attacker' order by random() limit 10) x)
    ) into v_pool;
    v_state:=jsonb_build_object('pools',v_pool,'round',1,'roundStarter',v_first,'currentTurn',v_first,'picks',jsonb_build_object(v_users[1]::text,'[]'::jsonb,v_users[2]::text,'[]'::jsonb),'used', '[]'::jsonb,'lastStarter',null);
  elsif g.game_type='quiz' or g.game_type='survival' then
    select jsonb_agg(to_jsonb(x)) into v_questions from (
      select id,category,prompt,options,correct_index,explanation from public.group_quiz_questions order by random() limit 10
    ) x;
    v_state:=jsonb_build_object('questions',v_questions,'round',1,'answers','{}'::jsonb,'activeUsers',to_jsonb(v_users));
  elsif g.game_type='guess' then
    select jsonb_agg(to_jsonb(x)) into v_cards from (
      select id,full_name,position_group,overall,rarity,nationality,clues from public.group_legend_cards order by random() limit 10
    ) x;
    v_state:=jsonb_build_object('players',v_cards,'round',1,'answers','{}'::jsonb);
  elsif g.game_type='cards' then
    select jsonb_agg(to_jsonb(x)) into v_cards from (
      select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards order by random() limit 20
    ) x;
    v_state:=jsonb_build_object('deck',v_cards,'round',1,'hands',jsonb_build_object(v_users[1]::text,'[]'::jsonb,v_users[2]::text,'[]'::jsonb),'selected','{}'::jsonb,'used','[]'::jsonb);
  else
    v_state:=jsonb_build_object('round',1,'actions','{}'::jsonb,'users',to_jsonb(v_users),'scores',jsonb_build_object(v_users[1]::text,0,v_users[2]::text,0));
  end if;
  update public.group_games set status='active',state=v_state,current_round=1,started_at=now(),
    deadline_at=now()+interval '30 seconds' where id=p_game_id;
  return v_state;
end;
$$;

create or replace function public.normalize_group_draft_lineup(p_picks jsonb,p_formation text)
returns jsonb language plpgsql immutable as $$
declare
  v_counts integer[]:=array[0,0,0];
  v_targets integer[];
  v_rows jsonb;
  v_item jsonb;
  v_source integer;
  v_target integer;
  v_best_distance integer;
  v_idx integer;
  v_line text;
  v_lines text[]:=array['defender','midfielder','attacker'];
  v_player jsonb;
  v_moved boolean;
begin
  v_targets:=case p_formation when '1-1-2' then array[1,1,2] when '1-2-1' then array[1,2,1] when '2-1-1' then array[2,1,1] else array[2,2,0] end;
  v_rows:=coalesce(p_picks,'[]'::jsonb);
  for v_item in select value from jsonb_array_elements(v_rows) where value->>'position_group'<>'goalkeeper' loop
    v_source:=array_position(v_lines,v_item->>'position_group');
    if v_source is not null then v_counts[v_source]:=v_counts[v_source]+1; end if;
  end loop;
  while exists(select 1 from generate_subscripts(v_counts,1) s where v_counts[s]>v_targets[s])
    and exists(select 1 from generate_subscripts(v_counts,1) s where v_counts[s]<v_targets[s]) loop
    v_source:=null;
    for v_idx in 1..3 loop if v_counts[v_idx]>v_targets[v_idx] then v_source:=v_idx; exit; end if; end loop;
    v_target:=null; v_best_distance:=99;
    for v_idx in 1..3 loop
      if v_counts[v_idx]<v_targets[v_idx] and abs(v_idx-v_source)<v_best_distance then
        v_target:=v_idx; v_best_distance:=abs(v_idx-v_source);
      end if;
    end loop;
    if v_source is null or v_target is null then exit; end if;
    v_moved:=false;
    for v_item in select value from jsonb_array_elements(v_rows)
      where value->>'position_group'=v_lines[v_source]
      order by (value->>'overall')::int asc loop
      v_rows:=jsonb_set(v_rows,array[(select ordinality-1 from jsonb_array_elements(v_rows) with ordinality e(value,ordinality) where e.value->>'id'=v_item->>'id' limit 1)::text,'assignedLine'],to_jsonb(v_lines[v_target]),true);
      v_moved:=true; exit;
    end loop;
    if not v_moved then exit; end if;
    v_counts[v_source]:=v_counts[v_source]-1; v_counts[v_target]:=v_counts[v_target]+1;
  end loop;
  return jsonb_build_object('formation',p_formation,'goalkeeper',(select value from jsonb_array_elements(v_rows) where value->>'position_group'='goalkeeper' limit 1),
    'fieldPlayers',(select jsonb_agg(jsonb_set(value,'{assignedLine}',coalesce(value->'assignedLine',value->'position_group'),true)) from jsonb_array_elements(v_rows) where value->>'position_group'<>'goalkeeper'),
    'lineCounts',jsonb_build_object('defender',v_counts[1],'midfielder',v_counts[2],'attacker',v_counts[3]));
end;
$$;

create or replace function public.settle_group_game_prize(p_game_id uuid,p_winners uuid[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.group_games%rowtype; v_count integer; v_share bigint; v_remainder bigint; v_user uuid; v_index integer:=0; v_winners uuid[]; v_amount bigint;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found or g.state->>'prizeSettled'='true' or g.prize_pool<=0 then return; end if;
  v_winners:=coalesce(p_winners,'{}'::uuid[]);
  select count(distinct x) into v_count from unnest(v_winners) x where x is not null;
  if v_count=0 then
    select array_agg(user_id order by joined_at) into v_winners
      from public.group_game_participants where game_id=p_game_id;
    select count(distinct x) into v_count from unnest(coalesce(v_winners,'{}'::uuid[])) x where x is not null;
  end if;
  if v_count=0 then
    update public.group_games set state=jsonb_set(state,'{prizeSettled}','true'::jsonb,true) where id=p_game_id;
    return;
  end if;
  v_share:=g.prize_pool/v_count;
  v_remainder:=g.prize_pool-(v_share*v_count);
  for v_user in select distinct x from unnest(v_winners) x where x is not null order by x loop
    v_index:=v_index+1;
    v_amount:=v_share+case when v_index=1 then v_remainder else 0 end;
    if v_amount>0 then
      perform public.group_wallet_change(g.telegram_chat_id,v_user,v_amount,
        'challenge_prize',p_game_id::text||':prize:'||v_user::text);
    end if;
  end loop;
  update public.group_games set state=jsonb_set(state,'{prizeSettled}','true'::jsonb,true) where id=p_game_id;
end;
$$;

create or replace function public.pick_group_draft_player(p_game_id uuid,p_user_id uuid,p_card_id text,p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.group_games%rowtype; v_card jsonb; v_pool jsonb; v_picks jsonb; v_users uuid[]; v_other uuid; v_round int; v_next uuid; v_starter uuid; v_lineup1 jsonb; v_lineup2 jsonb; v_score1 int; v_score2 int; v_winner uuid; v_formation1 text; v_formation2 text; v_key text;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found or g.game_type<>'draft' or g.status<>'active' then raise exception 'draft_not_active' using errcode='22023'; end if;
  if not p_auto and (g.state->>'currentTurn')::uuid<>p_user_id then raise exception 'draft_not_your_turn' using errcode='42501'; end if;
  if not p_auto and g.deadline_at<=now() then raise exception 'draft_turn_expired' using errcode='22023'; end if;
  select array_agg(user_id order by joined_at) into v_users from public.group_game_participants where game_id=p_game_id;
  v_round:=(g.state->>'round')::int;
  v_key:=case when v_round=1 then 'goalkeeper' else null end;
  if p_auto then
    select value into v_card from jsonb_array_elements(
      case when v_round=1 then g.state->'pools'->'goalkeeper'
      else (g.state->'pools'->'defender')||(g.state->'pools'->'midfielder')||(g.state->'pools'->'attacker') end
    ) where not (g.state->'used' ? (value->>'id')) order by random() limit 1;
  else
    select value into v_card from jsonb_array_elements(
      case when v_round=1 then g.state->'pools'->'goalkeeper'
      else (g.state->'pools'->'defender')||(g.state->'pools'->'midfielder')||(g.state->'pools'->'attacker') end
    ) where value->>'id'=p_card_id and not (g.state->'used' ? p_card_id) limit 1;
  end if;
  if v_card is null then raise exception 'draft_card_unavailable' using errcode='22023'; end if;
  if v_round=1 and v_card->>'position_group'<>'goalkeeper' then raise exception 'draft_goalkeeper_required' using errcode='22023'; end if;
  if v_round>1 and v_card->>'position_group'='goalkeeper' then raise exception 'draft_field_player_required' using errcode='22023'; end if;
  v_picks:=coalesce(g.state->'picks'->(p_user_id::text),'[]'::jsonb)||jsonb_build_array(v_card);
  update public.group_game_participants set picks=v_picks where game_id=p_game_id and user_id=p_user_id;
  perform public.record_group_mission_event(g.telegram_chat_id,p_user_id,'draft_pick','draft-pick:'||p_game_id||':'||p_user_id||':'||v_round);
  update public.group_games set state=jsonb_set(
    jsonb_set(state,array['picks',p_user_id::text],v_picks,true),
    '{used}',coalesce(state->'used','[]'::jsonb)||to_jsonb(v_card->>'id'),true
  ) where id=p_game_id;
  select * into g from public.group_games where id=p_game_id;
  if (select count(*) from public.group_game_participants where game_id=p_game_id and jsonb_array_length(picks)>=v_round) = 2 then
    if v_round=5 then
      select formation into v_formation1 from public.group_game_participants where game_id=p_game_id and user_id=v_users[1];
      select formation into v_formation2 from public.group_game_participants where game_id=p_game_id and user_id=v_users[2];
      v_lineup1:=public.normalize_group_draft_lineup(g.state->'picks'->v_users[1]::text,v_formation1);
      v_lineup2:=public.normalize_group_draft_lineup(g.state->'picks'->v_users[2]::text,v_formation2);
      v_score1:=coalesce((select sum((value->>'overall')::int) from jsonb_array_elements(v_lineup1->'fieldPlayers')),0)+coalesce((v_lineup1->'goalkeeper'->>'overall')::int,0);
      v_score2:=coalesce((select sum((value->>'overall')::int) from jsonb_array_elements(v_lineup2->'fieldPlayers')),0)+coalesce((v_lineup2->'goalkeeper'->>'overall')::int,0);
      v_winner:=case when v_score1>v_score2 then v_users[1] when v_score2>v_score1 then v_users[2] else null end;
      update public.group_game_participants set score=case user_id when v_users[1] then v_score1 else v_score2 end,status=case when v_winner is null then 'completed' when user_id=v_winner then 'winner' else 'completed' end where game_id=p_game_id;
      update public.group_games set status='completed',completed_at=now(),deadline_at=null,winner_user_id=v_winner,
        state=state||jsonb_build_object('resolvedLineups',jsonb_build_object(v_users[1]::text,v_lineup1,v_users[2]::text,v_lineup2),'scores',jsonb_build_object(v_users[1]::text,v_score1,v_users[2]::text,v_score2))
        where id=p_game_id;
      if g.prize_pool>0 then perform public.settle_group_game_prize(p_game_id,case when v_winner is null then array[v_users[1],v_users[2]] else array[v_winner] end); end if;
      perform public.record_group_mission_event(g.telegram_chat_id,v_users[1],'game_completed','complete:'||p_game_id||':'||v_users[1]);
      perform public.record_group_mission_event(g.telegram_chat_id,v_users[2],'game_completed','complete:'||p_game_id||':'||v_users[2]);
      if v_winner is not null then perform public.record_group_mission_event(g.telegram_chat_id,v_winner,'game_won','win:'||p_game_id||':'||v_winner); end if;
      perform public.record_group_mission_event(g.telegram_chat_id,v_users[1],'group_game_completed','group-complete:'||p_game_id);
      return jsonb_build_object('completed',true,'winner',v_winner,'scores',jsonb_build_object(v_users[1]::text,v_score1,v_users[2]::text,v_score2));
    end if;
    v_starter:=case when (g.state->>'roundStarter')::uuid=v_users[1] then v_users[2] else v_users[1] end;
    v_round:=v_round+1;
    update public.group_games set state=jsonb_set(
      jsonb_set(jsonb_set(state,'{round}',to_jsonb(v_round),true),'{roundStarter}',to_jsonb(v_starter),true),
      '{currentTurn}',to_jsonb(v_starter),true
    ),current_round=v_round,deadline_at=now()+interval '30 seconds'
    where id=p_game_id;
  else
    select user_id into v_next from public.group_game_participants where game_id=p_game_id and user_id<>p_user_id;
    update public.group_games set state=jsonb_set(state,'{currentTurn}',to_jsonb(v_next),true),deadline_at=now()+interval '30 seconds' where id=p_game_id;
  end if;
  return jsonb_build_object('completed',false,'round',v_round,'currentTurn',(select state->>'currentTurn' from public.group_games where id=p_game_id));
end;
$$;

create or replace function public.process_group_draft_timeouts(p_limit integer default 20)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare g record; v_count integer:=0; v_user uuid; v_card text;
begin
  for g in select id,state->>'currentTurn' as current_turn from public.group_games
    where game_type='draft' and status='active' and deadline_at<=now()
    order by deadline_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
  loop
    v_user:=g.current_turn::uuid;
    perform public.pick_group_draft_player(g.id,v_user,null,true);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create table if not exists public.group_mission_claims (
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  mission_id text not null references public.group_mission_definitions(id) on delete cascade,
  period_key text not null,
  user_id uuid not null references public.game_users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key(telegram_chat_id,mission_id,period_key,user_id)
);

create or replace function public.claim_group_mission(
  p_chat_id bigint,p_user_id uuid,p_mission_id text
) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.group_mission_definitions%rowtype; v_period text; v_subject text; v_progress public.group_mission_progress%rowtype; v_balance bigint;
begin
  select * into m from public.group_mission_definitions where id=p_mission_id and active;
  if not found then raise exception 'group_mission_unavailable' using errcode='P0002'; end if;
  v_period:=case m.cadence
    when 'daily' then to_char(now() at time zone 'Asia/Tehran','YYYY-MM-DD')
    when 'weekly' then to_char(date_trunc('week',now() at time zone 'Asia/Tehran'),'YYYY-MM-DD')
    when 'monthly' then to_char(now() at time zone 'Asia/Tehran','YYYY-MM')
    else 'all-time' end;
  v_subject:=case when m.scope='group' then 'group' else p_user_id::text end;
  select * into v_progress from public.group_mission_progress
    where telegram_chat_id=p_chat_id and mission_id=p_mission_id and period_key=v_period and subject_key=v_subject for update;
  if not found or v_progress.progress<m.target_count then raise exception 'group_mission_incomplete' using errcode='22023'; end if;
  if exists(select 1 from public.group_mission_claims where telegram_chat_id=p_chat_id and mission_id=p_mission_id and period_key=v_period and user_id=p_user_id) then
    raise exception 'group_mission_claimed' using errcode='23505';
  end if;
  insert into public.group_mission_claims(telegram_chat_id,mission_id,period_key,user_id)
    values(p_chat_id,p_mission_id,v_period,p_user_id);
  if m.scope='member' then
    update public.group_mission_progress set claimed_at=now()
      where telegram_chat_id=p_chat_id and mission_id=p_mission_id and period_key=v_period and subject_key=v_subject;
  end if;
  v_balance:=public.group_wallet_change(p_chat_id,p_user_id,m.reward_coins,'group_mission_reward','mission:'||p_mission_id||':'||v_period||':'||p_user_id::text);
  return v_balance;
end;
$$;

alter table public.group_economies enable row level security;
alter table public.group_wallets enable row level security;
alter table public.group_currency_transactions enable row level security;
alter table public.group_legend_cards enable row level security;
alter table public.group_quiz_questions enable row level security;
alter table public.group_games enable row level security;
alter table public.group_game_participants enable row level security;
alter table public.group_mission_definitions enable row level security;
alter table public.group_mission_progress enable row level security;
alter table public.group_mission_events enable row level security;
alter table public.group_mission_claims enable row level security;
revoke all on public.group_economies,public.group_wallets,public.group_currency_transactions,public.group_legend_cards,
  public.group_quiz_questions,public.group_games,public.group_game_participants,public.group_mission_definitions,
  public.group_mission_progress,public.group_mission_events,public.group_mission_claims from public,anon,authenticated;

revoke all on function public.settle_group_game_prize(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.settle_group_game_prize(uuid,uuid[]) to service_role;
revoke all on function public.group_wallet_change(bigint,uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.record_group_mission_event(bigint,uuid,text,text) from public,anon,authenticated;
revoke all on function public.create_group_game(bigint,uuid,text,bigint,integer,text) from public,anon,authenticated;
revoke all on function public.join_group_game(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.start_group_game(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pick_group_draft_player(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.process_group_draft_timeouts(integer) from public,anon,authenticated;
revoke all on function public.claim_group_mission(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.group_wallet_change(bigint,uuid,bigint,text,text) to service_role;
grant execute on function public.record_group_mission_event(bigint,uuid,text,text) to service_role;
grant execute on function public.create_group_game(bigint,uuid,text,bigint,integer,text) to service_role;
grant execute on function public.join_group_game(uuid,uuid,uuid,text) to service_role;
grant execute on function public.start_group_game(uuid,uuid) to service_role;
grant execute on function public.pick_group_draft_player(uuid,uuid,text,boolean) to service_role;
grant execute on function public.process_group_draft_timeouts(integer) to service_role;
grant execute on function public.claim_group_mission(bigint,uuid,text) to service_role;
