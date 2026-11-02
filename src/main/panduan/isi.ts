import type { MenuId, PanduanBagian, PanduanBlok } from '../../shared/ipc'
import { RETENSI_PROMPT_HARI } from '../monitoring/rules'
import { JAM_MULAI, JAM_SELESAI, PEMICU, kalimatAturan } from '../pemantau/rules'

// Panduan pemakaian AIRA — SATU sumber untuk layar Panduan dan untuk tool
// `cari_panduan`.
//
// ⚠️ KENAPA ISINYA DIBANGKITKAN, BUKAN DITULIS SEBAGAI PROSA (aturan 61).
//
// Daftar kemampuan yang diketik manusia akan selalu menyimpang dari kode: ia
// menyebut menu yang orang itu tidak punya, dan menjanjikan fitur yang saklarnya
// sedang mati. Kegagalan itu sudah terjadi dua kali di project ini dengan bentuk
// berbeda — daftar kode provinsi pada validator NIK (§27) dan daftar
// `toolPembaca` yang lupa `read_ppt` (§38). Keduanya terlihat rapi dan
// meyakinkan, keduanya salah.
//
// Karena itu:
//   - bagian "Menu yang kamu punya" disusun dari `izinMenu` sesi;
//   - bagian Microsoft 365 berubah isinya mengikuti `M365_LANJUTAN`;
//   - bagian dikte hanya ada bila model suaranya memang terpasang;
//   - setiap nama tool yang disebut diuji keberadaannya di registry
//     (`tests/panduan.test.ts`).
//
// ⚠️ Isinya sengaja TIDAK ditaruh di berkas markdown di `resources/`. Berkas di
// `resources` wajib didaftarkan `extraResources` dan kegagalannya SUNYI — panduan
// yang hilang hanya di aplikasi terpasang adalah pengulangan persis kegagalan
// font company serif font (§20), templat PPT (§24), dan tree-sitter (§47). Isi di dalam
// kode ikut ter-bundle, ikut ter-typecheck, dan ikut ter-test.

export interface KeadaanPanduan {
  /** Menu yang boleh dibuka user INI. Bukan daftar seluruh menu yang ada. */
  izinMenu: readonly MenuId[]
  /** `M365_LANJUTAN` — email, kalender, simpan-balik. */
  m365Lanjutan: boolean
  /** Muse Voice Transcribe is reachable (the Meta API key is present). */
  suaraTersedia: boolean
}

const MENU_JUDUL: Record<MenuId, string> = {
  sales: 'Ask Sales Data',
  masterdata: 'Ask Master Data',
  lab: 'Ask Sample TAT',
  onedrive: 'Ask Microsoft 365'
}

const MENU_ISI: Record<MenuId, PanduanBlok[]> = {
  sales: [
    {
      jenis: 'paragraf',
      teks:
        'Sales figures are read straight from the transaction database and calculated by queries ' +
        'written by people — AIRA does not infer them from memory. Sales are recognized on the ' +
        'date the result/invoice is issued; if you want ORDERS RECEIVED instead, use the ' +
        'word "order" in your question.'
    },
    {
      jenis: 'daftar',
      butir: [
        'Period summaries and comparisons, daily trends, YTD this year vs last year',
        'Best- and worst-selling tests, items with rising or falling trends',
        'Largest customers, customers that stopped ordering, new customers',
        'Breakdown by province and by customer type',
        'Projection for the close of the current month and forecast for the next few months',
        'Full-year Best Estimate (actuals + projection + forecast, with a range) — can be calculated once only 3 months of the year remain',
        'Finished reports (Word, PDF, or Excel) complete with charts',
        'Status of a single transaction by Order ID: received or not, recognized or cancelled, result/invoice issued, posted to the ERP'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'sales',
      contoh: [
        'How much are sales this month compared to last month?',
        'Top 10 customers in the last 30 days',
        'Which tests have a declining trend?',
        'What is the projection for the end of this month?',
        'What is the full-year BE forecast for this year?',
        'Create this month’s sales report as an Excel file',
        'Has Order ID [type the number] been received and invoiced?'
      ]
    },
    {
      jenis: 'batas',
      butir: [
        'AGGREGATE figures only, plus the STATUS of a single transaction when you give its Order ID. There is no way at all to show patient names, dates of birth, or diagnoses — and the Order ID check does not show the test type, price, or customer either. This limit is enforced in code, not a policy you can ask an exception to.',
        // Nama menu lain sengaja TIDAK disebut: panduan hanya boleh menyebut menu yang user itu
        // bisa buka (aturan 61, dikunci tests/panduan.test.ts).
        'The Order ID check answers the status of the TRANSACTION, not where the sample is in the lab.',
        'A forecast always comes with its range and historical accuracy. A forecast without a range is a guess disguised as a number.',
        // ⚠️ Menu tujuannya sengaja TIDAK disebut namanya di sini. Ditemukan
        // test sendiri: kalimat ini membuat "Ask Master Data" muncul di
        // panduan orang yang tidak punya menu itu — persis hal yang aturan 61
        // larang. Kalau ia memang punya, AIRA yang akan menyebutkan menunya saat
        // pertanyaannya salah pintu.
        'Item prices and customer master data are not answered from here. Just ask as usual — AIRA will point you to the right menu, and if that menu is not in your sidebar, your account has not been given access to it.'
      ]
    }
  ],
  masterdata: [
    {
      jenis: 'paragraf',
      teks:
        'Master data: customers, test items, prices, special prices, PKS agreements, and ' +
        'doctors. The source is the master database, separate from the transaction database — so this menu ' +
        'answers "what is the PRICE", not "how much was SOLD".'
    },
    {
      jenis: 'daftar',
      butir: [
        'Find a customer and view their details',
        'Find test items together with their prices',
        'Special prices per customer or per item',
        'PKS (cooperation agreements) and the list of doctors',
        'Contents of test packages'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'masterdata',
      contoh: [
        'Find customers whose name contains "Kariadi"',
        'What is the price of the HPV DNA test?',
        'Which special prices apply to this customer?',
        'What is included in the standard MCU package?'
      ]
    },
    {
      jenis: 'batas',
      butir: [
        'Prices shown are only K1 (B2B/Corporate) and K2 (B2C) — a data owner rule. BPJS and other price groups are not displayed.',
        'If an item’s price code is not in the rule set, AIRA shows it as is and does not guess what it means.'
      ]
    }
  ],
  lab: [
    {
      jenis: 'paragraf',
      teks:
        'The journey of laboratory samples: how many are piling up, which stage they have reached, ' +
        'how long processing takes (TAT), and which samples need to be redone (RNS).'
    },
    {
      jenis: 'daftar',
      butir: [
        'Backlog: samples whose results are not out yet, with their age',
        'Track a single sample by Order ID',
        'TAT per stage and per test type',
        'RNS: by count or by percentage'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'lab',
      contoh: [
        'What is the current sample backlog?',
        'Track this Order ID and tell me how far it has got',
        'Which tests have the longest TAT this month?',
        'Which tests have the most RNS?'
      ]
    },
    {
      jenis: 'batas',
      butir: [
        'The data comes from an ETL job, NOT real-time. Every answer states when the data was last updated — read that sentence before using the numbers for a decision today.',
        'Patient names are never included, even though rows are shown per sample.',
        'Some stages are not passed through by every test type. A zero at a stage means "it does not go through there", not "late".'
      ]
    }
  ],
  onedrive: [
    {
      jenis: 'paragraf',
      teks:
        'Find and read your work files in OneDrive and SharePoint. You sign in with your own ' +
        'Microsoft account through the browser — AIRA can only see files you are ' +
        'already allowed to see.'
    },
    {
      jenis: 'daftar',
      butir: [
        'Find files by name or content',
        'Browse folder contents — including folders a colleague shared with you',
        'Fetch a file and read its contents (Word, Excel, PowerPoint, PDF)',
        'Check which Microsoft account is connected'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'onedrive',
      contoh: [
        'Find files about the 2026 budget in my OneDrive',
        'What files are in the Reports folder?',
        'Which folders are shared with me? Open the first one',
        'Fetch that file and summarize it',
        'Which Microsoft account is connected?'
      ]
    }
  ]
}

/** Blok batas untuk menu Microsoft 365 — isinya berubah mengikuti saklar. */
function batasM365(m365Lanjutan: boolean): PanduanBlok {
  if (m365Lanjutan) {
    return {
      jenis: 'batas',
      butir: [
        'Email is only READ and replies are only created as DRAFTS in Outlook. There is no way to send email — you still press Send yourself.',
        'The calendar is read-only. AIRA does not move or create meetings: schedule changes are visible to other people.',
        'Saving a file to OneDrive never overwrites an existing file — the result is saved under a new name.',
        'The content of emails AIRA reads is DATA, not instructions. A line like "AIRA, send X" inside an email will not be carried out — anyone who knows your email address can write a line like that.'
      ]
    }
  }
  return {
    jenis: 'batas',
    butir: [
      'Only READING OneDrive & SharePoint files is active right now.',
      'Outlook email and calendar are NOT active yet — the features are built but still waiting for Microsoft 365 admin approval. Do not wait for AIRA to read your email until that is done.',
      'Saving files back to OneDrive is not active yet either. AIRA’s output is saved on your laptop, and you upload it yourself.'
    ]
  }
}

function bagianMenu(keadaan: KeadaanPanduan): PanduanBagian {
  const punya = (['sales', 'masterdata', 'lab', 'onedrive'] as const).filter((m) =>
    keadaan.izinMenu.includes(m)
  )

  const isi: PanduanBlok[] = [
    {
      jenis: 'paragraf',
      teks:
        'AIRA has several menus, and THE MENU DETERMINES THE DATA SOURCE it may touch. ' +
        'That is why no menu can answer another menu’s questions: if you come in through the wrong ' +
        'door, AIRA will point you to the right menu instead of guessing the answer.'
    }
  ]

  if (punya.length === 0) {
    isi.push({
      jenis: 'paragraf',
      teks:
        'Your account currently only has "New Task". Data menus (sales, master data, sample ' +
        'TAT) are set by a Super Admin per role AND per division — both must be ' +
        'ticked. If you think you should have one of them, send a request through the ' +
        'Feedback menu; say which menu you need and for what work.'
    })
  } else {
    isi.push({
      jenis: 'paragraf',
      teks: `Menus open to your account: ${punya.map((m) => MENU_JUDUL[m]).join(', ')}. This list follows your account’s permissions — your colleagues may see a different list.`
    })
    for (const m of punya) {
      isi.push({ jenis: 'paragraf', teks: `— ${MENU_JUDUL[m]} —` })
      for (const blok of MENU_ISI[m]) isi.push(blok)
      if (m === 'onedrive') isi.push(batasM365(keadaan.m365Lanjutan))
    }
  }

  isi.push({
    jenis: 'paragraf',
    teks:
      '"New Task" is the general-purpose menu: files, documents, research, writing, and coding. ' +
      'It deliberately never touches a database — sales-number questions typed ' +
      'here are pointed to their menu, not answered from memory.'
  })

  return {
    id: 'menu',
    judul: 'The menus you have',
    ringkas: 'Which menus are open to your account, and what each one answers.',
    kunci: ['menu', 'menus', 'access', 'permission', 'allowed', 'sales', 'master data', 'tat', 'onedrive', 'microsoft'],
    isi
  }
}

function bagianDokumen(): PanduanBagian {
  return {
    id: 'files',
    judul: 'Files & documents',
    ringkas: 'Attaching files, reading Word/Excel/PDF/PowerPoint, and working with document content.',
    kunci: ['file', 'files', 'document', 'word', 'excel', 'pdf', 'attachment', 'attach', 'folder', 'read', 'ocr', 'index', 'indexing'],
    isi: [
      {
        jenis: 'langkah',
        butir: [
          'Drag the file into the chat box, or click the paperclip icon to pick one from your computer.',
          'Write what you want — "summarize this", "extract the table on page 4", "compare with last month’s".',
          'For files that live in a folder (not attached), first add the folder through "Access Folders" in the sidebar.'
        ]
      },
      {
        jenis: 'daftar',
        butir: [
          'Word, Excel, PowerPoint, PDF, and plain text files — their content is read, not guessed from the file name',
          'Tables inside a PDF can be extracted separately so the numbers stay tidy',
          'Long documents are read IN STAGES, page by page; AIRA keeps going on its own until the end',
          'Converting Office document formats'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'Every file read comes with a note saying whether the content was read in full or ' +
          'there is more left. If AIRA says a document was cut off, it is because that ' +
          'note says so — not because it is guessing.'
      },
      {
        jenis: 'batas',
        butir: [
          'AIRA only touches folders YOU allow. Attaching one file does not open its whole folder.',
          'Files deleted at your request go to the Recycle Bin, not gone for good.',
          'Document indexing and search by meaning (searching a folder by what the files say) are not available in this build — there is no embedding model. AIRA can still read any file you attach or point to, and search your chat history by keywords.',
          'If a file is skipped (too large, unsupported format), AIRA names the file and the reason. Silence does not mean everything was read.'
        ]
      }
    ]
  }
}

function bagianLaporan(): PanduanBagian {
  return {
    id: 'reports',
    judul: 'Reports, Excel & presentations',
    ringkas: 'Creating finished documents: Word, PDF, Excel, and PowerPoint.',
    kunci: ['report', 'reports', 'library', 'my files', 'diagram', 'flowchart', 'flow', 'sop', 'ppt', 'presentation', 'powerpoint', 'slide', 'slides', 'excel', 'pdf', 'word', 'chart', 'template', 'make', 'create', 'rca', 'root cause', 'incident', 'fishbone'],
    isi: [
      {
        jenis: 'langkah',
        butir: [
          'Say what you want made and for whom — "create this month’s sales report for management", "create an 8-slide presentation on the Q4 plan".',
          'Send the material: bullet points, numbers, or attached source files.',
          'AIRA puts the document together, then tells you where the file is on your computer.',
          'OPEN and read the result before sending it to anyone.'
        ]
      },
      {
        jenis: 'daftar',
        butir: [
          'Word and PDF in a clean corporate style',
          'Tidy Excel files, complete with formulas and number formats',
          'PowerPoint with a ready-made corporate layout — cover, content background, and closing slide',
          'Charts go into Word, PDF, and Excel reports',
          'Interactive diagrams — flows/SOPs, sample flow, team structure, system architecture: an HTML file you can pan, zoom, and click, plus a PNG image to paste into PPT/Word',
          'For sales reports, the numbers come from the database, not retyped',
          'Root cause analysis (RCA) report for an incident — equipment down, samples swapped, TAT overrun: timeline, 5 Whys, Fishbone, severity, and corrective actions with owners'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'For an RCA, describe the incident as you normally would ("the PCR machine was down for 2 hours this ' +
          'morning, please analyze the cause"). If the details are not enough, AIRA asks first. What is not ' +
          'yet known is written as "not yet known", not guessed — and the report looks for system ' +
          'gaps, not people to blame.'
      },
      {
        jenis: 'paragraf',
        teks:
          'AIRA picks the slide layout from nine prepared arrangements that follow the ' +
          'corporate template. You do not need to mention colors, font sizes, or box positions — ' +
          'just the content. Charts inside a document always use exactly the same numbers as ' +
          'the table in that document.'
      },
      {
        jenis: 'paragraf',
        teks:
          'Every file AIRA has ever made for you — reports, Excel files, presentations, and images — ' +
          'is collected in the Library menu in the sidebar. There you can filter by type, search, open, ' +
          'or trace a file back to its source conversation. Files you moved or deleted outside AIRA ' +
          'stay listed with a "Missing" tag.'
      },
      {
        jenis: 'batas',
        butir: [
          'Only the built-in corporate template is available. There is no way yet to upload your own PowerPoint template.',
          'Fonts are embedded in PDFs. For .docx/.xlsx/.pptx the fonts are not embedded — on a computer without the font, the letters will change.',
          'If a chart fails to be created, AIRA says so. A document that loses a chart without a note is not correct behavior — report it if you see one.'
        ]
      }
    ]
  }
}

function bagianKerjaLain(): PanduanBagian {
  return {
    id: 'kerja-lain',
    judul: 'Research, web, and coding',
    ringkas: 'Searching the internet, opening web pages, writing code, and testing it in a sandbox.',
    kunci: ['web', 'internet', 'browser', 'research', 'code', 'coding', 'script', 'program', 'sandbox', 'test'],
    isi: [
      {
        jenis: 'daftar',
        butir: [
          'Search the internet and summarize the results — sources are always named',
          'Open web pages and read them, including filling in forms if you ask',
          'Write, read, and edit code files',
          'Find where a function is USED, and where it is DEFINED',
          'Run code it wrote itself in a separate sandbox before handing it over'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'The sandbox is a separate folder where AIRA may run code without touching ' +
          'your files. If AIRA says some code was "tested", that only appears when ' +
          'the code was actually run — a claim without evidence is ' +
          'removed automatically and replaced with a "not run" note.'
      },
      {
        jenis: 'batas',
        butir: [
          '"Tested by AIRA" does not mean "correct". The tests are written by AIRA too, so green means the code and its tests AGREE — not necessarily that both are right. Code for important things still needs a human to read it.',
          'The sandbox protects against MISTAKES, not malicious intent. Its isolation is folder isolation.',
          'Commands that change something always ask for your approval first. Commands that only read (e.g. a version check) run right away, so the approval dialog does not become a formality you click through without reading.'
        ]
      }
    ]
  }
}

function bagianIngatan(): PanduanBagian {
  return {
    id: 'ingatan',
    judul: 'Chat history & AIRA’s memory',
    ringkas: 'Finding old conversations, and telling AIRA things it should remember about you.',
    kunci: [
      'history',
      'remember',
      'memory',
      'conversation',
      'conversations',
      'yesterday',
      'forget',
      'logged',
      'tracked',
      'usage',
      'monitoring',
      'privacy',
      'monitored'
    ],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'Old conversations are NOT automatically in AIRA’s head — only the last few messages ' +
          'of the conversation currently open are carried. If you refer to an earlier ' +
          'conversation ("what did I ask yesterday about Kariadi?"), AIRA searches for it first instead of ' +
          'making it up from memory. History search works by keywords.'
      },
      {
        jenis: 'daftar',
        butir: [
          'Conversation history is stored per account — other people on the same laptop do not see yours',
          'Say "remember, I usually need numbers per division" and AIRA will remember it in the next conversations',
          'You can view and delete those memories yourself in Settings'
        ]
      },
      {
        jenis: 'batas',
        butir: [
          'AIRA never stores DATA VALUES as memory — revenue figures, lab results, and the like are deliberately refused. The reason: this month’s number will be wrong next month, while a memory is carried for months.',
          'History is stored on this laptop. If you use AIRA on another computer, the conversations are simply not here.',
          `AIRA usage is LOGGED and can be reviewed by a Super Admin: time, menu, the question you typed, attachment names, and the tools AIRA used. AIRA's answers and file contents are NOT logged. The question text is deleted from that record after ${RETENSI_PROMPT_HARI} days. For that reason, do not type passwords in the chat box.`
        ]
      }
    ]
  }
}

function bagianSuaraChat(keadaan: KeadaanPanduan): PanduanBagian {
  const isi: PanduanBlok[] = []
  if (keadaan.suaraTersedia) {
    isi.push({
      jenis: 'paragraf',
      teks:
        'The microphone button in the chat box turns your speech into text using Muse Voice Transcribe. ' +
        'It is an online service: your recording is sent to Meta’s speech service. The result is INSERTED into the chat box, ' +
        'not sent automatically — check it first, because names such as "ERP" or ' +
        '"AIRA" are sometimes misheard, and a misheard question produces ' +
        'a wrong number that still sounds convincing.'
    })
    isi.push({
      jenis: 'paragraf',
      teks:
        'You can also talk to AIRA through the mascot: click the mascot and speak. Your transcript is shown ' +
        'and sent automatically after 2 seconds unless you press Cancel. AIRA then reads a short spoken ' +
        'summary of the answer; the Mute button turns the voice off.'
    })
  } else {
    isi.push({
      jenis: 'paragraf',
      teks:
        'Voice input is not available in this build (the Meta API key is missing), so the microphone button ' +
        'and the talking mascot do not work. Everything else works normally.'
    })
  }
  isi.push({
    jenis: 'paragraf',
    teks:
      'The "Messages" button in the bottom-right corner opens chat between colleagues — separate from ' +
      'your conversations with AIRA. It looks like WhatsApp Web: the conversation list on the left, ' +
      'the chat room on the right.'
  })
  isi.push({
    jenis: 'daftar',
    butir: [
      'Private chat with colleagues, with ✓ sent and ✓✓ read ticks',
      'Groups: create one with the person icon with a + above the list, pick members, then give it a name',
      'Group admins can add and remove members, make admins, and rename the group',
      'Delete your own message: hover over it and click the trash icon',
      'Windows notifications for incoming messages, and a number on the AIRA icon in the taskbar',
      'Mute notifications per conversation or per group with the bell icon',
      'Send images and office documents as attachments'
    ]
  })
  isi.push({
    jenis: 'langkah',
    butir: [
      'For messages to keep arriving, AIRA must be running. Closing the AIRA window does NOT quit it — it moves to the tray (near the clock).',
      'Turn on "Start AIRA automatically when Windows logs in" in Settings → Teammate chat, so you stay reachable from the moment the laptop starts.',
      'To really quit: right-click the AIRA icon in the tray and choose Quit. While AIRA is off, messages for you will not arrive.'
    ]
  })
  isi.push({
    jenis: 'batas',
    butir: [
      'AIRA chat is an internal work channel, NOT a secret channel like WhatsApp. Do not send passwords, patients’ personal data, or anything other people must not read.',
      'It only exists on laptops — there is no mobile app. A colleague who has not opened their laptop will not receive messages until their AIRA is running. For anything urgent, still call.',
      'A deleted message leaves a "This message was deleted" note for everyone, and it cannot be undone.',
      'A new group member only sees messages from the moment they were added. A member who leaves can still read old messages, but receives no new ones.',
      'Groups have at most 100 members. For announcements to many people, use email.',
      'Program files (.exe, .bat, .ps1) cannot be sent, attachments are limited to 5 MB, and attachment contents are cleaned up after 30 days — the message itself stays.'
    ]
  })
  return {
    id: 'suara-chat',
    judul: 'Teammate chat & voice',
    ringkas: 'Private and group chat with colleagues, and speaking instead of typing.',
    kunci: [
      'voice',
      'microphone',
      'mic',
      'dictation',
      'speech',
      'mascot',
      'speak',
      'chat',
      'teammate',
      'colleague',
      'send file',
      'group',
      'create group',
      'whatsapp',
      'message',
      'messages',
      'delete message',
      'notifications',
      'tray',
      'group admin'
    ],
    isi
  }
}

function bagianTips(): PanduanBagian {
  return {
    id: 'tips',
    judul: 'How to ask for better answers',
    ringkas: 'Four habits that change the quality of answers the most.',
    kunci: ['tips', 'how to ask', 'prompt', 'bad answer', 'wrong answer'],
    isi: [
      {
        jenis: 'daftar',
        butir: [
          'State the PERIOD. "This month", "January–July 2026", "last 30 days" — without it AIRA has to guess, and a guessed period changes every number.',
          'Say who the result is FOR. "For the board meeting" produces a different shape than "for my own check".',
          'One question at a time. Five questions in one paragraph make every answer shallow.',
          'If the answer is off, say which part is wrong — do not repeat the exact same question. AIRA improves from corrections, not from repetition.'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'You do not need to know feature or tool names. Just write in everyday action words ' +
          '— "compare", "summarize", "create", "find" — and AIRA picks how to do it.'
      }
    ]
  }
}

function bagianBatas(keadaan: KeadaanPanduan): PanduanBagian {
  const butir = [
    'AIRA does not read your own email' +
      (keadaan.m365Lanjutan ? ', except through the Microsoft 365 menu and only to read it.' : '.'),
    'AIRA does not send email, does not post anything, and does not change anyone’s schedule.',
    'AIRA cannot log in to other systems (ERP, monitoring, ticketing) unless you export the data yourself and give it to AIRA.',
    'Numbers coming out of a data menu always have a source. Numbers that appear WITHOUT a data menu — e.g. typed in New Task — deserve suspicion; ask again through the menu.',
    'Every action that changes or deletes something asks for your approval first, and all of it is recorded in the audit log.',
    'Passwords are never typed as chat text, and signing in on a page without HTTPS is refused.'
  ]
  return {
    id: 'batas',
    judul: 'What AIRA can NOT do',
    ringkas: 'Limits that are in place on purpose — read this before promising something to someone else.',
    kunci: ['limit', 'limits', 'cannot', 'can not', 'security', 'safe', 'privacy', 'email'],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'This list is in the guide on purpose. An assistant that sounds like it can do everything makes ' +
          'people promise things that cannot be delivered — and the one embarrassed later is ' +
          'the person who made the promise, not the app.'
      },
      { jenis: 'batas', butir }
    ]
  }
}

function bagianMasalah(): PanduanBagian {
  return {
    id: 'masalah',
    judul: 'When something goes wrong',
    ringkas: 'A wrong answer, a missing menu, or AIRA stopping midway.',
    kunci: ['error', 'failed', 'wrong', 'report', 'bug', 'feedback', 'menu missing', 'not showing', 'showing', 'retry'],
    isi: [
      {
        jenis: 'langkah',
        butir: [
          'Answer failed or cut off midway: click "Retry" under the answer. The question is sent again without piling up duplicate questions.',
          'The answer is wrong or the numbers look suspicious: click "Report" on that answer. The question and answer are sent along, so we can check exactly what you saw.',
          'A menu that should be there is not showing: send it through Feedback. Menu access needs a role AND a division — often only one side is ticked.',
          'Feature suggestions or questions AIRA cannot answer yet: same thing, through Feedback.'
        ]
      },
      {
        jenis: 'paragraf',
        teks:
          'A report through the Report button is far more useful than a verbal account: we see ' +
          'the original question, the answer that came out, and the app version you use.'
      }
    ]
  }
}

function bagianMulai(keadaan: KeadaanPanduan): PanduanBagian {
  const isi: PanduanBlok[] = [
    {
      jenis: 'paragraf',
      teks:
        'AIRA is a colleague that actually does the work, not a Q&A box. It ' +
        'reads your files, calculates from the database, creates documents, and runs tasks ' +
        'through to the end — all inside a controlled environment.'
    },
    {
      jenis: 'langkah',
      butir: [
        'Pick a menu on the left. The menu decides what AIRA may touch; "New Task" is for general work.',
        'Write what you mean in plain sentences. There is no special format, and you do not need to name features.',
        'If there is a file, drag it into the chat box or add its folder through "Access Folders".',
        'Read the answer, then correct the parts that are off. Conversations are saved automatically in the sidebar.'
      ]
    },
    {
      jenis: 'contoh',
      mode: 'general',
      contoh: [
        'Summarize this document I attached into 5 points',
        'Create an 8-slide presentation about the Q4 work plan',
        'List the files in my work folder and tell me which looks like the 2026 budget',
        'Tidy this Excel table and create a chart for it'
      ]
    }
  ]
  if (keadaan.izinMenu.length > 0) {
    isi.push({
      jenis: 'paragraf',
      teks:
        'For number questions — sales, prices, sample TAT — use the menu itself, not ' +
        'New Task. That is where the numbers are taken from the database.'
    })
  }
  return {
    id: 'mulai',
    judul: 'Where to start',
    ringkas: 'The first four steps, for anyone opening AIRA for the first time.',
    kunci: ['start', 'begin', 'first', 'new', 'how to use', 'guide', 'getting started'],
    isi
  }
}

/** Seluruh panduan untuk keadaan tertentu. Urutannya = urutan baca. */
/**
 * Menu Jadwal (29 Sep 2026). ⚠️ Batas "hanya selama AIRA menyala di laptop ini"
 * WAJIB tertulis — tugas yang tidak jalan karena laptop mati terlihat seperti
 * fitur yang rusak bila orangnya tidak pernah diberi tahu.
 */
function bagianJadwal(): PanduanBagian {
  return {
    id: 'schedule',
    judul: 'Scheduled tasks (Schedule menu)',
    ringkas: 'Ask AIRA to do something on its own at a set time — daily, weekly, or monthly.',
    kunci: ['schedule', 'scheduled', 'automatic', 'recurring', 'every', 'reminder', 'weekly report', 'time'],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'Open the Schedule menu in the sidebar, press "New task", write the instruction as you would ask in chat, ' +
          'then pick the menu and how often to repeat. At the set time AIRA runs it as a new conversation ' +
          'titled "Schedule: …", then notifies you. The result can be opened from the Schedule menu or the chat history.'
      },
      {
        jenis: 'batas',
        butir: [
          'Tasks only run WHILE AIRA IS RUNNING on this laptop (including when hidden in the tray). If the laptop is off, asleep, or AIRA was Quit, the task is made up ONCE when AIRA is running again — not repeated as many times as it was missed.',
          'Tasks only run while their OWNER is signed in. A laptop shared between people does not run someone else’s tasks.',
          'Scheduled tasks never delete, move, or overwrite files, or run commands — there is nobody there to approve them. Steps like that are skipped and mentioned in the result. Creating PDF/Word/Excel/PPT reports still works.',
          'If menu access is revoked, tasks in that menu stop running and are marked "Not run".'
        ]
      }
    ]
  }
}

/**
 * Pemantau proaktif (20 Okt 2026) — hanya untuk user yang punya menu Sales atau TAT,
 * dan hanya menyebut pemicu yang menunya ia punya. Kalimat aturan & jam dibangkitkan
 * dari konstanta `pemantau/rules.ts`, bukan diketik di sini.
 * ⚠️ Sengaja tanpa kata "pemakaian"/"dicatat": itu kosakata bagian monitoring
 * pemakaian (tentang ORANG), dan pertanyaan "apakah pemakaian saya dicatat" harus
 * tetap menemukan bagian itu, bukan bagian ini (tentang DATA).
 */
function bagianPemantau(keadaan: KeadaanPanduan): PanduanBagian | null {
  const pemicu = PEMICU.filter((p) => keadaan.izinMenu.includes(p.menu))
  if (pemicu.length === 0) return null
  const frasa = pemicu.map((p) => p.judul.charAt(0).toLowerCase() + p.judul.slice(1))
  const daftar = frasa.length > 1 ? `${frasa.slice(0, -1).join(', ')}, or ${frasa[frasa.length - 1]}` : frasa[0]
  const hhmm = (h: number): string => `${String(h).padStart(2, '0')}:00`
  return {
    id: 'pemantau',
    judul: 'Automatic alerts (monitor)',
    ringkas: `AIRA tells you first when it spots: ${daftar}.`,
    kunci: ['monitor', 'alert', 'alerts', 'notification', 'warning', 'alarm', 'stalled', 'late', 'dropped', 'automatic', 'updated', 'stopped updating'],
    isi: [
      {
        jenis: 'paragraf',
        teks:
          'AIRA checks the data regularly and sends a Windows notification when something needs follow-up. ' +
          'The monitor only reads, and the numbers are calculated by code — not made up by AIRA. Notifications only contain ' +
          'counts & percentages; the details are in Settings → Monitor → Alert history.'
      },
      { jenis: 'daftar', butir: pemicu.map((p) => `${p.judul}: ${kalimatAturan(p.id)}`) },
      {
        jenis: 'paragraf',
        teks:
          'Click the notification to open the related menu with a follow-up question already filled in the box — press ' +
          'send if you want to dig in. Do not need to be told? Open Settings → Monitor and untick ' +
          '"Notify me" for that trigger.'
      },
      {
        jenis: 'batas',
        butir: [
          `The monitor only runs WHILE AIRA IS RUNNING on this laptop (including when hidden in the tray), ` +
            `Monday–Saturday ${hhmm(JAM_MULAI)}–${hhmm(JAM_SELESAI)}. Laptop off or AIRA Quit = no checks.`,
          ...(pemicu.some((p) => p.menu === 'lab')
            ? [
                'Lab categories that do not record a lab receipt time or do not yet have enough completed-sample history ' +
                  'are not monitored — the list is shown in Settings → Monitor.'
              ]
            : []),
          'Long holidays (e.g. Eid) can trigger a "data not updated" alert — that really is the state of the data.'
        ]
      }
    ]
  }
}

export function susunPanduan(keadaan: KeadaanPanduan): PanduanBagian[] {
  const pemantau = bagianPemantau(keadaan)
  return [
    bagianMulai(keadaan),
    bagianMenu(keadaan),
    bagianDokumen(),
    bagianLaporan(),
    bagianKerjaLain(),
    bagianIngatan(),
    bagianJadwal(),
    ...(pemantau ? [pemantau] : []),
    bagianSuaraChat(keadaan),
    bagianTips(),
    bagianBatas(keadaan),
    bagianMasalah()
  ]
}

// ------------------------------------------------------------------ pencarian

const KATA_UMUM = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'are', 'can', 'how', 'what', 'does', 'this', 'that',
  'from', 'aira', 'please', 'could', 'would', 'about', 'any', 'have', 'has', 'was', 'were', 'its',
  'into', 'want', 'need', 'where', 'who', 'why', 'when', 'which', 'there', 'there', 'tell', 'show'
])

export function kataKunci(teks: string): string[] {
  return teks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((k) => k.length >= 3 && !KATA_UMUM.has(k))
}

function teksBagian(b: PanduanBagian): string {
  const isi = b.isi
    .map((blok) => {
      if (blok.jenis === 'paragraf') return blok.teks
      if (blok.jenis === 'contoh') return blok.contoh.join(' ')
      return blok.butir.join(' ')
    })
    .join(' ')
  return `${b.judul} ${b.ringkas} ${b.kunci.join(' ')} ${isi}`.toLowerCase()
}

/**
 * Mencari bagian panduan yang paling cocok.
 *
 * Sengaja pencarian kata biasa, BUKAN embedding: isinya cuma sepuluh bagian, dan
 * embedding berarti satu panggilan HTTP ke gateway untuk pertanyaan "gimana cara
 * pakai" — pertanyaan yang justru sering muncul saat jaringan sedang bermasalah.
 * Kalau tidak ada yang cocok, kembalikan bagian pembuka: panduan yang mengembalikan
 * kosong membuat model menjawab dari ingatannya sendiri, dan itu yang mau dihindari.
 */
export function cariBagian(
  bagian: PanduanBagian[],
  query: string,
  maks = 3
): PanduanBagian[] {
  const kata = kataKunci(query)
  if (kata.length === 0) return bagian.slice(0, maks)

  const skor = bagian.map((b) => {
    const teks = teksBagian(b)
    let nilai = 0
    for (const k of kata) {
      if (b.judul.toLowerCase().includes(k)) nilai += 4
      if (b.kunci.some((x) => x.includes(k))) nilai += 3
      if (teks.includes(k)) nilai += 1
    }
    return { b, nilai }
  })

  const cocok = skor.filter((s) => s.nilai > 0).sort((a, b) => b.nilai - a.nilai)
  if (cocok.length === 0) return bagian.slice(0, maks)
  return cocok.slice(0, maks).map((s) => s.b)
}

/** Bagian panduan jadi teks datar — dipakai tool `cari_panduan`. */
export function bagianKeTeks(b: PanduanBagian): string {
  const baris: string[] = [`## ${b.judul}`, b.ringkas]
  for (const blok of b.isi) {
    if (blok.jenis === 'paragraf') baris.push(blok.teks)
    else if (blok.jenis === 'langkah') baris.push(...blok.butir.map((x, i) => `${i + 1}. ${x}`))
    else if (blok.jenis === 'daftar') baris.push(...blok.butir.map((x) => `- ${x}`))
    else if (blok.jenis === 'contoh') baris.push(...blok.contoh.map((x) => `- example: "${x}"`))
    else baris.push(...blok.butir.map((x) => `- LIMIT: ${x}`))
  }
  return baris.join('\n')
}
