export const DEPARTMENT_RULES = [
  {
    label: "Electrical Engineering",
    patterns: [
      /\belectrical engineering\b/i,
      /\bdepartment of electrical engineering\b/i
    ]
  },
  {
    label: "Electronics Engineering",
    patterns: [
      /\belectronics engineering\b/i,
      /\bdepartment of electronics engineering\b/i
    ]
  },
  {
    label: "Electrical and Electronics Engineering",
    patterns: [
      /\belectrical and electronics engineering\b/i,
      /\bdepartment of electrical and electronics engineering\b/i,
      /\beee\b/i
    ]
  },
  {
    label: "Electronics and Communication Engineering",
    patterns: [
      /\belectronics and communication engineering\b/i,
      /\belectronics and communications engineering\b/i,
      /\bdepartment of electronics and communication engineering\b/i,
      /\bdepartment of electronics and communications engineering\b/i,
      /\bece\b/i
    ]
  },
  {
    label: "Computer Science",
    patterns: [
      /\bcomputer science\b/i,
      /\bdepartment of computer science\b/i
    ]
  },
  {
    label: "Computer Science and Engineering",
    patterns: [
      /\bcomputer science and engineering\b/i,
      /\bdepartment of computer science and engineering\b/i,
      /\bcse\b/i
    ]
  }
];

export const SOURCES = [
  // IITs
  {
    id: "iitd-jobs",
    instituteType: "IIT",
    institute: "IIT Delhi",
    pageUrl: "https://home.iitd.ac.in/jobs-iitd/index.php",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitm-faculty",
    instituteType: "IIT",
    institute: "IIT Madras",
    pageUrl: "https://facapp.iitm.ac.in/",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "iitkgp-faculty",
    instituteType: "IIT",
    institute: "IIT Kharagpur",
    pageUrl: "https://erp.iitkgp.ac.in/Jobs/auth/facapps.htm",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iith-careers",
    instituteType: "IIT",
    institute: "IIT Hyderabad",
    pageUrl: "https://iith.ac.in/careers/",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitdh-faculty",
    instituteType: "IIT",
    institute: "IIT Dharwad",
    pageUrl: "https://www.iitdh.ac.in/faculty-recruitment",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "iitpkd-faculty",
    instituteType: "IIT",
    institute: "IIT Palakkad",
    pageUrl: "https://facap.iitpkd.ac.in/",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iitgoa-faculty",
    instituteType: "IIT",
    institute: "IIT Goa",
    pageUrl: "https://iitgoa.ac.in/faculty-position/",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitb-faculty",
    instituteType: "IIT",
    institute: "IIT Bombay",
    pageUrl: "https://www.iitb.ac.in/en/careers/faculty-recruitment",
    pageType: "html-links",
    batch: 1
  },
  // Missing IIT sources
  {
    id: "iitk-faculty",
    instituteType: "IIT",
    institute: "IIT Kanpur",
    pageUrl: "https://www.iitk.ac.in/faculty-recruitment",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iitr-faculty",
    instituteType: "IIT",
    institute: "IIT Roorkee",
    pageUrl: "https://iitr.ac.in/Careers/Faculty%20Positions/index.html",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitg-faculty",
    instituteType: "IIT",
    institute: "IIT Guwahati",
    pageUrl: "https://iitg.ac.in/iitg_page_details?page=61%2Ffac_rec",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "iitj-faculty",
    instituteType: "IIT",
    institute: "IIT Jodhpur",
    pageUrl: "https://www.iitj.ac.in/faculty-positions/en/faculty-positions",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iitrpr-faculty",
    instituteType: "IIT",
    institute: "IIT Ropar",
    pageUrl: "https://www.iitrpr.ac.in/faculty-positions",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitp-faculty",
    instituteType: "IIT",
    institute: "IIT Patna",
    pageUrl: "https://www.iitp.ac.in/services-amenities/stores-and-purchase/archived-tenders?catid=18&id=2363%3Aadvertisement-for-faculty-positions-at-the-level-of-assistant-professor-associate-professor-and-professor-in-iit-patna&view=article",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "iiti-faculty",
    instituteType: "IIT",
    institute: "IIT Indore",
    pageUrl: "https://www.iiti.ac.in/recruitments/faculty-positions",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iitmandi-faculty",
    instituteType: "IIT",
    institute: "IIT Mandi",
    pageUrl: "https://www.iitmandi.ac.in/recruitments/teaching",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitbhu-faculty",
    instituteType: "IIT",
    institute: "IIT (BHU) Varanasi",
    pageUrl: "https://www.iitbhu.ac.in/dean/dofa/recruitment",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "iitbhilai-faculty",
    instituteType: "IIT",
    institute: "IIT Bhilai",
    pageUrl: "https://www.iitbhilai.ac.in/index.php?pid=rec_faculty",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iitjammu-faculty",
    instituteType: "IIT",
    institute: "IIT Jammu",
    pageUrl: "https://iitjammu.ac.in/faculty-search-cum-selection",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iittp-faculty",
    instituteType: "IIT",
    institute: "IIT Tirupati",
    pageUrl: "https://www.iittp.ac.in/facultyrecruitment",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "iitism-faculty",
    instituteType: "IIT",
    institute: "IIT (ISM) Dhanbad",
    pageUrl: "https://www.iitism.ac.in/faculty-positions",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "iitbbs-faculty",
    instituteType: "IIT",
    institute: "IIT Bhubaneswar",
    pageUrl: "https://www.iitbbs.ac.in/index.php/faculty-affairs/faculty-recruitment/",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "iitgn-faculty",
    instituteType: "IIT",
    institute: "IIT Gandhinagar",
    pageUrl: "https://iitgn.ac.in/careers/faculty-rolling-advertisement",
    pageType: "html-links",
    batch: 1
  },
  // NITs
  {
    id: "nitrkl-faculty",
    instituteType: "NIT",
    institute: "NIT Rourkela",
    pageUrl: "https://www.nitrkl.ac.in/Career/Faculty/",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitw-faculty",
    instituteType: "NIT",
    institute: "NIT Warangal",
    pageUrl: "https://nitw.ac.in/faculty",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitt-jobs",
    instituteType: "NIT",
    institute: "NIT Tiruchirappalli",
    pageUrl: "https://www.nitt.edu/other/jobs",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "vnit-current-openings",
    instituteType: "NIT",
    institute: "VNIT Nagpur",
    pageUrl: "https://vnit.ac.in/position-open/",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitmz-recruitment-feed",
    instituteType: "NIT",
    institute: "NIT Mizoram",
    pageUrl: "https://nitmz.ac.in/",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitkkr-faculty",
    instituteType: "NIT",
    institute: "NIT Kurukshetra",
    pageUrl: "https://nitkkr.ac.in/recruitment-notification-for-faculty-positions/",
    pageType: "html-links",
    batch: 1
  },
  // Missing NIT sources
  {
    id: "nita-faculty",
    instituteType: "NIT",
    institute: "NIT Agartala",
    pageUrl: "https://www.nita.ac.in/UserPanel/Minutes_Others.aspx?file=Recruitment",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitap-andhra-faculty",
    instituteType: "NIT",
    institute: "NIT Andhra Pradesh",
    pageUrl: "https://nitandhra.ac.in/main/careers.php",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitap-arunachal-faculty",
    instituteType: "NIT",
    institute: "NIT Arunachal Pradesh",
    pageUrl: "https://www.nitap.ac.in/category_list_details?cate=Recruitments",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "nitc-faculty",
    instituteType: "NIT",
    institute: "NIT Calicut",
    pageUrl: "https://nitc.ac.in/faculty-recruitments",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitdelhi-faculty",
    instituteType: "NIT",
    institute: "NIT Delhi",
    pageUrl: "https://nitdelhi.ac.in/faculty-recruitment/",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitdgp-faculty",
    instituteType: "NIT",
    institute: "NIT Durgapur",
    pageUrl: "https://nitdgp.ac.in/p/careers",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "nitgoa-faculty",
    instituteType: "NIT",
    institute: "NIT Goa",
    pageUrl: "https://www.nitgoa.ac.in/careers.html",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nith-faculty",
    instituteType: "NIT",
    institute: "NIT Hamirpur",
    pageUrl: "https://rec.nith.ac.in/",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitj-faculty",
    instituteType: "NIT",
    institute: "NIT Jalandhar",
    pageUrl: "https://www.nitj.ac.in/research/jobs.html",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "nitjsr-faculty",
    instituteType: "NIT",
    institute: "NIT Jamshedpur",
    pageUrl: "https://www.nitjsr.ac.in/Recruitments",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitmanipur-faculty",
    instituteType: "NIT",
    institute: "NIT Manipur",
    pageUrl: "https://nitmanipur.ac.in/ViewAll.aspx?view=Vacancies",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitmgh-faculty",
    instituteType: "NIT",
    institute: "NIT Meghalaya",
    pageUrl: "https://www.nitm.ac.in/news.php?n=recruitment",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "nitnagaland-faculty",
    instituteType: "NIT",
    institute: "NIT Nagaland",
    pageUrl: "https://www.nitnagaland.ac.in/index.php/recruitment",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitp-faculty",
    instituteType: "NIT",
    institute: "NIT Patna",
    pageUrl: "https://www.nitp.ac.in/Others/faculty-recruitment",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitpy-faculty",
    instituteType: "NIT",
    institute: "NIT Puducherry",
    pageUrl: "https://nitpy.ac.in/Opportunities",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "nitrr-faculty",
    instituteType: "NIT",
    institute: "NIT Raipur",
    pageUrl: "https://www.nitrr.ac.in/advertisement.php",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitsikkim-faculty",
    instituteType: "NIT",
    institute: "NIT Sikkim",
    pageUrl: "https://nitsikkim.ac.in/institute/job_oppurtunities.php",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nitsilchar-faculty",
    instituteType: "NIT",
    institute: "NIT Silchar",
    pageUrl: "https://www.nits.ac.in/recruitment-view-all",
    pageType: "html-links",
    batch: 1
  },
  {
    id: "nitsri-faculty",
    instituteType: "NIT",
    institute: "NIT Srinagar",
    pageUrl: "https://nitsri.ac.in/Pages/JobsMain.aspx",
    pageType: "html-links",
    batch: 2
  },
  {
    id: "nitk-faculty",
    instituteType: "NIT",
    institute: "NIT Surathkal",
    pageUrl: "https://www.nitk.ac.in/Assistant-Professor_Faculty_Recruitment",
    pageType: "html-links",
    batch: 0
  },
  {
    id: "nituk-faculty",
    instituteType: "NIT",
    institute: "NIT Uttarakhand",
    pageUrl: "https://nituk.ac.in/recruitments",
    pageType: "html-links",
    batch: 1
  }
];
