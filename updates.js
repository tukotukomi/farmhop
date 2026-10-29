// The developer log shown by Settings > Updates, newest day first. ONE ENTRY PER DAY, written for players in plain, friendly words,
// one SHORT line per change (a few words to one short sentence: long lines cost translation effort and are tiring to read).
// When more changes land on a day that already has an entry, edit that entry to describe where things ended up (never list the steps
// taken on the way, or things that were replaced the same day). Every entry has its Spanish (es) and Simplified Chinese (zh) text beside
// the English: keep the three in step, with the same number of lines in the same order.
// This file is plain data: { date: 'YYYY-MM-DD', title, notes: [...], es: { title, notes }, zh: { title, notes } }.
export const UPDATES = [
  {
    date: '2026-10-29',
    title: 'A bigger farm and a brighter stage',
    notes: [
      'More Land: buy the field next door for 500 sunflowers to make your farm twice as big.',
      'The countryside around the farm: meadows, hills, a river, lakes, fields and rock gardens, different on every farm.',
      'Fish now go in your Fish Backpack. Sell them from the Fish Pond whenever you like.',
      'The Jam Stage lights glow at night, with spotlights on whoever is performing.',
      'New decorations: a disco ball (100) and the Big Jam Stage (200).',
      'Now and then a hopper puts on a show on the Jam Stage, and friends come to watch.',
      'Clouds in the sky while fishing and hopping.',
      'The Latency Helper is fixed, and it offers to help if fishing feels off beat.',
      'Hops sound just like your hopper on the Jam Stage.',
      'The hopper button shows your own hopper, in their colour.',
      'Twice as many fish to catch, and some only bite at night.',
      'Easier fish keep their taps right on the beat.',
      'Every menu fits your screen.',
      'The farm buttons sit at the bottom right with Play on the end, or on the left with the new Left-handed mode.',
      'Sign in with Google before becoming a Hop Supporter, so your support is kept safe.',
      'This Updates page!'
    ],
    es: {
      title: 'Una granja más grande y un escenario más brillante',
      notes: [
        'Más terreno: compra el campo de al lado por 500 girasoles y tu granja será el doble de grande.',
        'El campo alrededor de la granja: praderas, colinas, un río, lagos, cultivos y jardines de rocas, distinto en cada granja.',
        'Los peces ahora van a tu Mochila de peces. Véndelos en el estanque cuando quieras.',
        'Las luces del escenario brillan de noche, con focos sobre quien esté actuando.',
        'Nuevos adornos: una bola de discoteca (100) y el Gran escenario (200).',
        'De vez en cuando un saltarín da un concierto en el escenario, y otros vienen a verlo.',
        'Nubes en el cielo al pescar y al saltar.',
        'El Ayudante de latencia está arreglado, y se ofrece a ayudar si al pescar vas fuera de ritmo.',
        'Los saltos suenan igual que tu saltarín en el escenario.',
        'El botón de saltarín muestra al tuyo, en su color.',
        'El doble de peces para pescar, y algunos solo pican de noche.',
        'Los peces más fáciles mantienen los toques justo en el ritmo.',
        'Todos los menús caben en tu pantalla.',
        'Los botones de la granja están abajo a la derecha, con Jugar al final, o a la izquierda con el nuevo Modo zurdo.',
        'Inicia sesión con Google antes de hacerte Hop Supporter, para que tu apoyo quede a salvo.',
        '¡Esta página de Novedades!'
      ]
    },
    zh: {
      title: '更大的农场，更亮的舞台',
      notes: [
        '更多土地：花 500 朵向日葵买下隔壁的田地，农场变成两倍大。',
        '农场周围的乡间：草地、山丘、小河、湖泊、田地和岩石花园，每个农场都不一样。',
        '钓到的鱼现在会放进鱼背包，可以随时在鱼塘卖掉。',
        '音乐舞台的灯在夜里会发光，聚光灯照着正在表演的伙伴。',
        '新装饰：迪斯科球（100）和大音乐舞台（200）。',
        '时不时会有伙伴上台表演，其他伙伴也会来看。',
        '钓鱼和跳跳时，天上有了云朵。',
        '延迟助手修好了，钓鱼节奏没对上时它还会主动来帮忙。',
        '跳跃的声音和你的伙伴在舞台上的声音一模一样。',
        '伙伴按钮会显示你自己的伙伴和它的颜色。',
        '可以钓的鱼多了一倍，有些只在夜里咬钩。',
        '比较简单的鱼，节拍都正好落在拍子上。',
        '所有菜单都能放进你的屏幕。',
        '农场按钮移到了右下角，开始按钮在最边上；打开新的左手模式就会放到左边。',
        '成为跳跳支持者前先用 Google 登录，让你的支持更安全。',
        '这个“更新”页面！'
      ]
    }
  },
  {
    date: '2026-10-28',
    title: 'Hop Supporters, nights on the farm and new friends',
    notes: [
      'Become a Hop Supporter for $5: DJ Ribbit, Moonbun, a supporter heart and a drum and bass farm song.',
      'The farm has a day: sunsets, moonlit nights, torches round the pond and fireflies.',
      'Sign in with Google to save your farm and play on any device.',
      'New hoppers: Spicy Spider, Lyla, Carla and Sir Racha.',
      'Every hopper has a voice of their own, in tune with the music.',
      'Bigger fish bring trickier rhythms, all the way up to sixteenth notes.',
      'A closer fishing camera you can turn, tilt and zoom.',
      'Rhythm latency settings and a Latency Helper for well-timed taps.',
      'A Song slider on the Jam Stage, to hear just the instruments.',
      'Your sunflower glows after dark so you never lose your hopper.',
      'Softer shadows, and a Credits section in Settings.'
    ],
    es: {
      title: 'Hop Supporters, noches en la granja y nuevos amigos',
      notes: [
        'Hazte Hop Supporter por 5 $: DJ Ribbit, Conejita Luna, un corazón de apoyo y una canción de drum and bass.',
        'La granja tiene su día: atardeceres, noches de luna, antorchas junto al estanque y luciérnagas.',
        'Inicia sesión con Google para guardar tu granja y jugar en cualquier dispositivo.',
        'Nuevos saltarines: Araña Picante, Lyla, Carla y Sir Racha.',
        'Cada saltarín tiene su propia voz, afinada con la música.',
        'Los peces más grandes traen ritmos más difíciles, hasta semicorcheas.',
        'Una cámara de pesca más cercana que puedes girar, inclinar y acercar.',
        'Ajustes de latencia del ritmo y un Ayudante de latencia para acertar los toques.',
        'Un control de Canción en el escenario, para oír solo los instrumentos.',
        'Tu girasol brilla de noche para que nunca pierdas a tu saltarín.',
        'Sombras más suaves y una sección de Créditos en Ajustes.'
      ]
    },
    zh: {
      title: '跳跳支持者、农场之夜和新朋友',
      notes: [
        '花 5 美元成为跳跳支持者：DJ 呱呱、月亮兔、支持者爱心，还有鼓打贝斯版农场音乐。',
        '农场有了白天和黑夜：日落、月夜、鱼塘边的火把和萤火虫。',
        '用 Google 登录，保存你的农场，在任何设备上玩。',
        '新伙伴：辣辣蜘蛛、莱拉、卡拉和是拉差。',
        '每个伙伴都有自己的声音，和音乐同一个调。',
        '鱼越大，节奏越难，最难到十六分音符。',
        '更近的钓鱼镜头，可以转动、倾斜和缩放。',
        '节奏延迟设置和延迟助手，让点击更准。',
        '音乐舞台上的“音乐”滑块，只听乐器的声音。',
        '你的向日葵在夜里会发光，再也不会找不到你的伙伴。',
        '更柔和的影子，设置里还有“制作”一栏。'
      ]
    }
  },
  {
    date: '2026-10-27',
    title: 'A home of its own, and friends',
    notes: [
      'Farm Hop moved to its own home: farmhop.fun!',
      'Play with friends on their own phones and computers: on your farm, on the Jam Stage and in Co-Op Hop.',
      'Join a friend with a room code.',
      'More players on one screen with extra controllers or a keyboard.',
      'Hop your hopper around the farm between rounds.',
      'Go fishing at the Fish Pond, reeling in to the music, and fill your Fish Book.',
      'A Farm Buildings menu, and Betty Lou gives farm tips.',
      'A full screen button.'
    ],
    es: {
      title: 'Un hogar propio, y amigos',
      notes: [
        '¡Farm Hop se mudó a su propio hogar: farmhop.fun!',
        'Juega con amigos desde sus propios teléfonos y ordenadores: en tu granja, en el escenario y en el Salto cooperativo.',
        'Únete a un amigo con un código de sala.',
        'Más jugadores en una pantalla con mandos extra o un teclado.',
        'Mueve a tu saltarín por la granja entre rondas.',
        'Pesca en el estanque recogiendo el sedal al ritmo de la música, y llena tu Libro de peces.',
        'Un menú de Edificios de la granja, y Betty Lou da consejos.',
        'Un botón de pantalla completa.'
      ]
    },
    zh: {
      title: '有了自己的家，还有朋友',
      notes: [
        'Farm Hop 搬进了自己的家：farmhop.fun！',
        '和朋友用他们自己的手机和电脑一起玩：在你的农场、音乐舞台和合作跳跳里。',
        '输入房间代码加入朋友。',
        '多加手柄或键盘，一块屏幕上就能多人一起玩。',
        '回合之间可以带着你的伙伴在农场里跳来跳去。',
        '去鱼塘钓鱼，跟着音乐收线，填满你的鱼类图鉴。',
        '新增“农场建筑”菜单，贝蒂·露还会给你农场小贴士。',
        '全屏按钮。'
      ]
    }
  },
  {
    date: '2026-10-26',
    title: 'The Jam Stage and Co-Op Hop',
    notes: [
      'Build the Jam Stage and play your hopper like an instrument, or the drums.',
      'Jam together with phones as extra instruments.',
      'Co-Op Hop: hop the road with a friend, on one screen or split in two.',
      'The farm is twice as big, with Decorate mode and a decorations shop.',
      'Start with Betty Lou and invite the others from the Bunkhouse.',
      'A Graphics setting, and much smoother play.'
    ],
    es: {
      title: 'El escenario y el Salto cooperativo',
      notes: [
        'Construye el escenario y toca a tu saltarín como un instrumento, o la batería.',
        'Toca en grupo con teléfonos como instrumentos extra.',
        'Salto cooperativo: salta el camino con un amigo, en una pantalla o dividida en dos.',
        'La granja es el doble de grande, con modo Decorar y una tienda de adornos.',
        'Empieza con Betty Lou e invita a los demás desde la cabaña.',
        'Un ajuste de Gráficos, y el juego va mucho más fluido.'
      ]
    },
    zh: {
      title: '音乐舞台和合作跳跳',
      notes: [
        '建好音乐舞台，把你的伙伴当乐器来演奏，也可以打鼓。',
        '用手机当额外的乐器，一起合奏。',
        '合作跳跳：和朋友一起闯马路，同一屏幕或分屏都可以。',
        '农场变成两倍大，还有装饰模式和装饰品商店。',
        '一开始只有贝蒂·露，其他伙伴从小木屋邀请进来。',
        '新增“画质”设置，游戏流畅多了。'
      ]
    }
  },
  {
    date: '2026-10-25',
    title: 'Settings and the Bunkhouse',
    notes: [
      'A Settings menu with language and volume.',
      'Build the Bunkhouse and meet Tuko the fox.',
      'Drag and zoom to look around the farm.',
      'A new camera that follows behind your hopper on the road.'
    ],
    es: {
      title: 'Ajustes y la cabaña',
      notes: [
        'Un menú de Ajustes con idioma y volumen.',
        'Construye la cabaña y conoce a Tuko el zorro.',
        'Arrastra y acerca para mirar por la granja.',
        'Una nueva cámara que sigue a tu saltarín por detrás en el camino.'
      ]
    },
    zh: {
      title: '设置和小木屋',
      notes: [
        '设置菜单，可以调语言和音量。',
        '建好小木屋，认识小狐狸图科。',
        '拖动和缩放，在农场里四处看看。',
        '新镜头：在马路上跟在你的伙伴身后。'
      ]
    }
  },
  {
    date: '2026-10-23',
    title: "Betty Lou's Farm Hop",
    notes: [
      "A new name: Betty Lou's Farm Hop!",
      'Rounded, toy-like hoppers and a whole new look for the farm.',
      'A farm to come home to between rounds, with the Fish Pond.',
      'An 8-bit bluegrass soundtrack.',
      'The sun goes down as you hop, and a stampede of bulls to dodge.',
      'Every hopper has their own hop sound.'
    ],
    es: {
      title: "Betty Lou's Farm Hop",
      notes: [
        "¡Un nuevo nombre: Betty Lou's Farm Hop!",
        'Saltarines redondeados como juguetes y un aspecto totalmente nuevo.',
        'Una granja a la que volver entre rondas, con el estanque.',
        'Una banda sonora de bluegrass de 8 bits.',
        'El sol se pone mientras saltas, y una estampida de toros que esquivar.',
        'Cada saltarín tiene su propio sonido al saltar.'
      ]
    },
    zh: {
      title: "Betty Lou's Farm Hop",
      notes: [
        "新名字：Betty Lou's Farm Hop！",
        '圆滚滚、像玩具一样的伙伴，农场焕然一新。',
        '回合之间可以回农场，还有鱼塘。',
        '8 位元蓝草风格的配乐。',
        '跳着跳着太阳就落山了，还有一群公牛要躲开。',
        '每个伙伴都有自己的跳跃声。'
      ]
    }
  },
  {
    date: '2026-10-15',
    title: 'Controllers',
    notes: [
      'Play with a controller: the d-pad or stick to hop.'
    ],
    es: {
      title: 'Mandos',
      notes: [
        'Juega con un mando: la cruceta o el stick para saltar.'
      ]
    },
    zh: {
      title: '手柄',
      notes: [
        '可以用手柄玩：方向键或摇杆来跳。'
      ]
    }
  },
  {
    date: '2026-10-14',
    title: 'The very first hop',
    notes: [
      "Betty Lou's very first hop across the farm roads!",
      'Pick sunflowers, and dodge geese, combine harvesters and crop dusters.',
      'Choose your hopper: Betty Lou, Axolotl Princess, Catstar or LeafWish.'
    ],
    es: {
      title: 'El primerísimo salto',
      notes: [
        '¡El primerísimo salto de Betty Lou por los caminos de la granja!',
        'Recoge girasoles y esquiva gansos, cosechadoras y avionetas fumigadoras.',
        'Elige tu saltarín: Betty Lou, Princesa Ajolote, Catstar o LeafWish.'
      ]
    },
    zh: {
      title: '第一跳',
      notes: [
        '贝蒂·露第一次跳过农场的马路！',
        '摘向日葵，躲开大鹅、联合收割机和农用飞机。',
        '选择你的伙伴：贝蒂·露、六角恐龙公主、星星猫或许愿叶。'
      ]
    }
  }
];
