const supportedCommands = {
    "WYZEC1": {
      "3": ["10242", "10243", "10070", "10071", "10072", "10073"],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10134",
        "10135",
        "10254",
        "10255",
        "10256",
        "10257",
        "10310",
        "10311",
        "10312",
        "10313",
        "10332",
        "10333"
      ],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091"],
      "13": ["10058", "10059"],
      "18": ["10148", "10149"]
    },
    "WYZEC1-JZ": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"],
      "26": ["10314", "10315", "10316", "10317"]
    },
    "WYZECP1_JEF": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292\n</plist>\n",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "5": ["11000", "11002", "11003", "11009"],
      "6": [
        "10332",
        "10333",
        "11004",
        "11020",
        "11021",
        "11022",
        "11023",
        "11010",
        "11011",
        "11012",
        "11013",
        "11014",
        "11015",
        "11016",
        "11017",
        "11006",
        "11007"
      ],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "10": [
        "11018",
        "11019",
        "11031",
        "11032",
        "11033",
        "11034",
        "11035",
        "11036",
        "11037",
        "11038",
        "11039"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": ["10058", "10059"],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"],
      "26": ["10314", "10315", "10316", "10317"]
    },
    "WVODB1": {
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10208",
        "10209",
        "10210",
        "10211",
        "10222",
        "10223",
        "11120",
        "11121",
        "11122",
        "11123",
        "10410",
        "10411"
      ],
      "14": [
        "10420",
        "10421",
        "10422",
        "10423",
        "10424",
        "10425",
        "10426",
        "10428",
        "10429",
        "10430",
        "10431",
        "10432",
        "10433",
        "10434",
        "10435",
        "10440",
        "10441",
        "10436",
        "10437",
        "10438",
        "10439",
        "10442",
        "10443",
        "10444",
        "10445",
        "10450",
        "10451",
        "10452",
        "10453",
        "10446"
      ],
      "16": [
        "10460",
        "10461",
        "10462",
        "10463",
        "10464",
        "10465",
        "10454",
        "10455",
        "11126"
      ],
      "19": ["10466", "10467", "10468", "10469", "10470", "10471"],
      "24": [
        "10246",
        "10247",
        "10446",
        "10447",
        "10114",
        "10115",
        "10456",
        "10457"
      ],
      "28": ["10448", "10449"]
    },
    "WVOD1": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "12": ["10076", "10077", "11091"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403",
        "10410",
        "10411",
        "10222",
        "10223"
      ],
      "14": [
        "10420",
        "10421",
        "10422",
        "10423",
        "10424",
        "10425",
        "10426",
        "10428",
        "10429",
        "10430",
        "10431",
        "10432",
        "10433",
        "10434",
        "10435",
        "10440",
        "10441",
        "10206",
        "10207",
        "10436",
        "10437",
        "10438",
        "10439",
        "10442",
        "10443",
        "10444",
        "10445",
        "10450",
        "10451",
        "10452",
        "10453",
        "10446"
      ],
      "16": [
        "10460",
        "10461",
        "10462",
        "10463",
        "10464",
        "10465",
        "10454",
        "10455",
        "11126"
      ],
      "17": ["10044", "10045", "10046", "10047"],
      "19": ["10474", "10475", "10466", "10467", "10468", "10469"],
      "24": ["10246", "10247", "10446", "10447", "10114", "10115"],
      "28": ["10448", "10449"],
      "29": ["10008", "10009"]
    },
    "WYZE_CAKP2JFUS": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_PAN2": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_CAM3P": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_PANP": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_PAN3": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_DB2": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_CAM4": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "HL_CFL2": {
      "3": [
        "10242",
        "10243",
        "10070",
        "10071",
        "10072",
        "10073",
        "10292",
        "10293"
      ],
      "4": [
        "10204",
        "10205",
        "10206",
        "10207",
        "10254",
        "10255",
        "10256",
        "10257",
        "10134",
        "10135",
        "10310",
        "10311",
        "10312",
        "10313"
      ],
      "6": ["10332", "10333"],
      "9": [
        "10397",
        "10396",
        "10395",
        "10394",
        "10390",
        "10391",
        "10392",
        "10393"
      ],
      "11": ["10350", "10351", "10352", "10353"],
      "12": ["10076", "10077", "11091", "10056", "10057"],
      "13": [
        "10058",
        "10059",
        "11110",
        "11111",
        "11112",
        "11113",
        "11114",
        "11115",
        "10400",
        "10401",
        "10402",
        "10403"
      ],
      "16": ["10044", "10045", "10046", "10047"],
      "18": ["10148", "10149"],
      "21": ["10600", "10601", "10602", "10603", "10604", "10605"],
      "23": ["10006", "10007"],
      "24": ["10246", "10247"],
      "25": ["10008", "10009"]
    },
    "default": {
      "1": [
        "10000",
        "10001",
        "10002",
        "10003",
        "10010",
        "10011",
        "10020",
        "10021",
        "10022",
        "10023",
        "10030",
        "10031",
        "10032",
        "10033",
        "10040",
        "10041",
        "10042",
        "10043",
        "10050",
        "10051",
        "10052",
        "10053",
        "10060",
        "10061",
        "10062",
        "10063",
        "10064",
        "10080",
        "10081",
        "10082",
        "10083",
        "10090",
        "10091",
        "10092",
        "10093",
        "10120",
        "10121",
        "10122",
        "10123",
        "10130",
        "10131",
        "10132",
        "10133",
        "10140",
        "10141",
        "10142",
        "10143",
        "10150",
        "10151",
        "10160",
        "10161",
        "10162",
        "10163",
        "10164",
        "10165",
        "10166",
        "10167",
        "10168",
        "10169",
        "10170",
        "10171",
        "10172",
        "10173",
        "10174",
        "10175",
        "10176",
        "10177",
        "10178",
        "10179",
        "10190",
        "10191",
        "10192",
        "10193",
        "10200",
        "10201",
        "10202",
        "10203",
        "10220",
        "10221",
        "10232",
        "10233",
        "10240",
        "10241",
        "10252",
        "10253",
        "10262",
        "10263",
        "10272",
        "10273",
        "10208",
        "10209",
        "10210",
        "10211",
        "11120",
        "11121",
        "11122",
        "11123"
      ],
      "2": [
        "1",
        "10280",
        "10281",
        "10282",
        "10283",
        "10300",
        "10301",
        "10302",
        "10303"
      ]
    }
  };
  
  const models = [
    "WYZEC1",
    "WYZEC1-JZ",
    "WYZECP1_JEF",
    "WVODB1",
    "WVOD1",
    "WYZE_CAKP2JFUS",
    "HL_PAN2",
    "HL_CAM3P",
    "HL_PANP",
    "HL_PAN3",
    "HL_DB2",
    "HL_CAM4",
    "HL_CFL2"
  ];