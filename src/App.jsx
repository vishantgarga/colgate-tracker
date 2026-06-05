import { useState, useEffect, useRef } from "react";
import { loadFromSupabase, saveToSupabase } from "./supabase.js";

const DAILY_TARGET = 15;
const PITCH_POSITIONS = ["Start","Middle","End"];
const NO_PITCH = "No Pitch Needed";
const STORE_TYPES = ["General Store","Kirana Store","Medical Store","Premium Medical Store","Paan Shop","SMT","Wholesaler"];
const isMedical = t => t === "Medical Store" || t === "Premium Medical Store";
const isSMT = t => t === "SMT";
let _c = Date.now();
const uid = () => String(_c++);

// ─── Month / Product Config ───────────────────────────────────────────────────
// June products: each MF size has a Red and Blue variant as separate keys.
// MF TDP count in summaries = sum of ALL MF variant sales (no separate toggle).
// Pitch timing: mfPitch (covers all MF), sensitiveTbrsPitch.

const MF_VARIANTS = [
  { sizeLabel:"MF 20rs",  redKey:"mf20rsRed",  blueKey:"mf20rsBlue"  },
  { sizeLabel:"MF 80g",   redKey:"mf80gRed",   blueKey:"mf80gBlue"   },
  { sizeLabel:"MF 100g",  redKey:"mf100gRed",  blueKey:"mf100gBlue"  },
  { sizeLabel:"MF 150g",  redKey:"mf150gRed",  blueKey:"mf150gBlue"  },
];

// All individual product keys for June
const JUNE_KEYS = [
  ...MF_VARIANTS.flatMap(v=>[v.redKey, v.blueKey]),
  "sensitiveTbrs",
];
const JUNE_PITCH_KEYS = ["mfPitch","sensitiveTbrsPitch"];

const MONTHS = {
  "may-2025": {
    label: "May 2025",
    products: [
      { key:"sensitiveSold",  label:"Sensitive TP", color:"#a78bfa", pitchKey:"sensitivePitch",  hasPitch:true  },
      { key:"superFlexiSold", label:"Super Flexi",  color:"#5ecfea", pitchKey:"superFlexiPitch", hasPitch:true  },
      { key:"cdc200Ordered",  label:"CDC 200g",     color:"#fb923c", pitchKey:"cdcPitch",        hasPitch:true  },
    ],
    statTiles: ["sensitiveSold","superFlexiSold","cdc200Ordered"],
  },
  "june-2025": {
    label: "June 2025",
    // products list used for summary rows and pitch tables
    // For June, rendering is custom (MF variants + TBRS)
    products: [
      { key:"sensitiveTbrs", label:"Sensitive TBRS", color:"#a78bfa", pitchKey:"sensitiveTbrsPitch", hasPitch:true },
    ],
    mfVariants: MF_VARIANTS,
    statTiles: [], // handled separately for June
  },
};

const CURRENT_MONTH = "june-2025";

const C = {
  bg:"#07090f", card:"#0d1019", card2:"#111520", border:"#1a2133",
  dim:"#1e2a3a", muted:"#485570", text:"#dce6f8",
  accent:"#4f8ef7", green:"#2dd4a0", amber:"#f5a623",
  red:"#f06a6a", purple:"#a78bfa", cyan:"#5ecfea", orange:"#fb923c",
  redVariant:"#f06a6a", blueVariant:"#60a5fa",
};

const iS = {
  background:C.bg, border:`1px solid ${C.border}`, borderRadius:10,
  color:C.text, padding:"11px 13px", fontSize:15,
  fontFamily:"inherit", outline:"none", width:"100%", boxSizing:"border-box",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getMonthCfg(day) {
  return MONTHS[day.month] || MONTHS["may-2025"];
}

function emptyJuneFields() {
  const f = {};
  JUNE_KEYS.forEach(k => { f[k] = null; });
  JUNE_PITCH_KEYS.forEach(k => { f[k] = null; });
  return f;
}

function emptyMayFields() {
  return {
    sensitiveSold:null, superFlexiSold:null, cdc200Ordered:null,
    sensitivePitch:null, superFlexiPitch:null, cdcPitch:null,
  };
}

// Count total MF units sold at a store (all Red+Blue variants)
function storeMfCount(store) {
  return MF_VARIANTS.reduce((n,v) => n + (store[v.redKey]===true?1:0) + (store[v.blueKey]===true?1:0), 0);
}

// ─── Seeds ────────────────────────────────────────────────────────────────────
function mkS(name,type,visited,order,sensitive,flexi,cdc,smt,smile,notes,sPitch,fPitch,cPitch) {
  return {
    id:uid(), name, type, visited, orderPlaced:order, month:"may-2025",
    sensitiveSold:sensitive, superFlexiSold:flexi, cdc200Ordered:cdc,
    sensitivePitch:sPitch||null, superFlexiPitch:fPitch||null, cdcPitch:cPitch||null,
    smt_contract:smt, smileGoal:smile, notes:notes||"",
    notOnVisit:false, notOnVisitReason:"",
    noOrderReason:"", noOrderReasonOther:"",
  };
}

function mkJ(name, type, visited, order, fields, smile, notes) {
  return {
    id:uid(), name, type, visited, orderPlaced:order, month:"june-2025",
    smt_contract:null, smileGoal:smile??null, notes:notes||"",
    notOnVisit:false, notOnVisitReason:"",
    noOrderReason:"", noOrderReasonOther:"",
    ...emptyJuneFields(),
    ...fields,
  };
}

const DAY3_STORES = [
  mkS("National dry","General Store",true,true,null,null,false,null,null,""),
  mkS("Noble medical","Medical Store",true,true,null,null,false,null,null,"Reorder the shelf for colgate visibility, sensitive stock was there"),
  mkS("London general store","General Store",true,true,null,null,false,null,null,""),
  mkS("Vaibhav stores","General Store",true,true,null,null,false,null,null,""),
  mkS("Ganesh","General Store",false,false,null,null,false,null,null,"Not visited, its shut"),
  mkS("Sarajal","General Store",false,false,null,null,false,null,null,"Closed"),
  mkS("Janta medical","Medical Store",true,true,true,null,false,null,null,"Smile 12/18"),
  mkS("Vishal general store","General Store",true,true,null,null,false,null,null,""),
  mkS("Anil store","Kirana Store",true,false,null,null,false,null,null,"Smile goal 4/6\nSuper flexi(sf) is there in stock"),
  mkS("Global medical","Medical Store",true,true,true,null,false,null,null,"Smile goal 22/29, max fresh ordered, handwash too"),
  mkS("Corner general store","General Store",true,true,null,null,false,null,null,"Smile goal 11/13"),
  mkS("Ashok medical","Medical Store",true,true,null,null,false,null,null,""),
  mkS("Prashanth stores","General Store",true,false,null,null,false,null,null,"Enough stock"),
  mkS("Medical","Medical Store",true,true,null,true,false,null,null,""),
  mkS("Manek stores supermarket","SMT",true,true,null,null,false,false,null,"Occ is the contracts name"),
  mkS("Bon bon medical","Medical Store",true,true,null,null,false,null,null,"11/18 smile goal"),
  mkS("Ambika medical","Medical Store",true,false,null,null,false,null,true,"Sufficient quantity"),
  mkS("Dhanvantru medical","Medical Store",true,true,null,null,false,null,null,"Reorder the shelf for colgate visibility"),
  mkS("Store 1","General Store",true,true,null,null,false,null,null,""),
  mkS("Store 2","General Store",true,true,null,true,false,null,null,""),
  mkS("Store 3","General Store",true,true,null,null,false,null,null,""),
];

const DAY4_STORES = [
  mkS("Shri aashapura store","Kirana Store",true,true,null,null,false,null,true,""),
  mkS("Ganesh super market","Kirana Store",true,true,null,null,false,null,true,""),
  mkS("Umar medical","Medical Store",true,true,null,null,false,null,true,""),
  mkS("Sidhi vinayak super market","Kirana Store",true,true,null,null,true,null,true,""),
  mkS("S mart retail and general store","General Store",true,true,null,null,false,null,null,"Smile goal 9/11"),
  mkS("Sameer stores","General Store",true,false,null,null,false,null,null,"Smile 9/11"),
  mkS("Mount mary society store","General Store",true,false,null,null,false,null,null,"No order because enough stock"),
  mkS("Chunilal punshi and co","General Store",true,true,null,true,false,null,null,""),
  mkS("Store 1","General Store",true,true,null,true,false,null,null,"Smile goal 4/8"),
  mkS("Store 2","General Store",true,true,null,true,false,null,true,""),
  mkS("Jay lakshmi medical and general store","Medical Store",true,true,null,true,false,null,null,""),
  mkS("Store 3","General Store",true,true,null,null,true,null,true,""),
  mkS("Bajrangbali store","Kirana Store",true,true,null,true,true,null,null,""),
  mkS("Prabhavati medical and general store","Medical Store",true,true,null,true,true,null,true,""),
  mkS("Store 4","General Store",true,true,null,true,false,null,null,""),
  mkS("Laxmi provision stores","General Store",true,true,null,true,true,null,null,""),
  mkS("Lalita apang store","General Store",true,false,null,null,false,null,null,"No order because enough stock"),
  mkS("Patel provision store","SMT",true,true,null,null,false,true,null,""),
  mkS("Lucky general store","General Store",true,true,null,true,false,null,null,""),
  mkS("Fine food bakery and general store","General Store",true,true,null,true,false,null,null,""),
  mkS("Abdul rahman general store","General Store",true,true,null,true,true,null,null,""),
  mkS("Aman chemist","Medical Store",true,true,true,true,false,null,null,""),
  mkS("Raza soap centre","General Store",true,true,null,null,false,null,null,""),
  mkS("F mart","General Store",true,true,null,true,false,null,null,"Store is open, but owner not there, will come at 1"),
  mkS("Crystal chemist","Medical Store",true,true,null,null,true,null,null,""),
  mkS("Store 5","Medical Store",true,true,true,null,false,null,null,""),
];

const DAY5_STORES = [
  mkS("Sonal medical","Medical Store",true,false,null,null,null,null,null,"Closed"),
  mkS("Sai medical","Medical Store",true,true,null,null,null,null,true,""),
  mkS("Store 3","General Store",true,true,null,true,null,null,null,""),
  mkS("Afzal shop centre","General Store",true,true,null,true,null,null,null,""),
  mkS("Store 2","General Store",true,true,null,true,null,null,null,""),
  mkS("Store 1","General Store",true,false,null,null,null,null,null,"Owner not there"),
  mkS("STM Medical and general store","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Ujala medical and general stores","Medical Store",true,true,null,null,null,null,true,""),
  mkS("New janta stores","General Store",true,true,null,null,null,null,true,"Amazing effort to complete smile goal"),
  mkS("Aaijee general stores","General Store",true,true,null,null,null,null,null,""),
  mkS("Abhay grain stores","Kirana Store",true,true,null,true,true,null,true,"",null,"End","End"),
  mkS("Awwal","Wholesaler",true,true,null,null,null,null,null,""),
  mkS("Sh general","General Store",true,false,null,null,null,null,null,""),
  mkS("Vijay medical","Medical Store",true,false,null,null,null,null,null,""),
  mkS("Neemchand govindji","Kirana Store",true,true,null,true,true,null,true,"",null,"End","End"),
  mkS("Nelson stores","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("New janseva medical","Medical Store",true,true,true,true,null,null,true,"","Start"),
  mkS("Ansari traders","Wholesaler",true,false,null,null,null,null,null,""),
  mkS("Noor medical","Medical Store",true,false,null,null,null,null,null,"No order, owner not there"),
  mkS("Madeshya medical","Medical Store",true,true,true,null,null,null,true,""),
  mkS("Hari medical and general store","Medical Store",true,true,null,true,null,null,true,""),
  mkS("Solanki medical and general store","Medical Store",true,true,null,true,true,null,true,"",null,"End"),
  mkS("Ruby medical and general store","Medical Store",true,true,null,null,null,null,true,""),
  mkS("GS store","General Store",true,true,null,null,true,null,null,""),
  mkS("DN gupta","General Store",true,false,null,null,null,null,null,"Enough stock no order"),
  mkS("Dharavi kirana store","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Store 4","General Store",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Shri sai krupa super market","General Store",true,false,null,null,null,null,null,""),
  mkS("Soap corner","General Store",true,true,null,null,null,null,null,""),
];

const DAY6_STORES = [
  mkS("Krishna medical","Medical Store",true,true,null,true,null,null,true,"",null,NO_PITCH),
  mkS("MV Shah","General Store",true,true,null,true,null,null,null,""),
  mkS("Hansraj","General Store",true,true,null,true,null,null,true,""),
  mkS("Vira store","General Store",true,true,null,true,null,null,true,"",null,NO_PITCH),
  mkS("Maharashtra grain store","Kirana Store",true,true,null,null,null,null,true,""),
  mkS("Kamgar","General Store",true,true,null,true,null,null,true,""),
  mkS("Kalyanji lakshmichand","General Store",true,true,null,null,null,null,null,""),
  mkS("Maharashtra stores","Paan Shop",true,true,null,true,null,null,null,""),
  mkS("Masrice","General Store",true,true,null,true,null,null,null,"",null,NO_PITCH),
  mkS("Sakriya general store","General Store",true,true,null,null,null,null,null,""),
];

// Day 14 — 4 June, Waseem Khan

const DAY7_STORES = [
  mkS("Manish medical","Medical Store",true,true,true,null,true,null,null,"","No Pitch Needed",null,"No Pitch Needed"),
  mkS("Janta general store","General Store",true,true,null,null,null,null,null,""),
  mkS("Diamond general store","Wholesaler",true,true,null,true,null,null,null,"",null,"No Pitch Needed"),
  mkS("Rehaan medical","Medical Store",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Devi medical","General Store",true,true,null,null,null,null,null,""),
  mkS("Shanti kirana","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Getwell","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Hari om","Medical Store",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Samrat medical","Medical Store",true,true,null,true,null,null,null,"",null,"No Pitch Needed"),
  mkS("Varsha medical","Medical Store",true,true,null,true,null,null,null,"",null,"No Pitch Needed"),
  mkS("Sheetal book depot","General Store",true,false,null,null,null,null,null,"No order, owner not there"),
  mkS("Rajan general","General Store",true,true,null,null,null,null,true,""),
  mkS("Jay Maharashtra store","General Store",true,true,null,null,null,null,null,""),
  mkS("Sangam","Kirana Store",true,true,null,null,true,null,null,"",null,null,"Start"),
  mkS("Paras medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Sangam medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Shiv shakti","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Ramdev general store","General Store",true,true,null,null,null,null,null,""),
  mkS("City medical","Medical Store",true,true,null,null,null,null,true,""),
  mkS("Badshah medical","Medical Store",true,true,null,null,null,null,true,""),
  mkS("Bali general and grain","General Store",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Prakash","Wholesaler",true,true,null,null,null,null,null,""),
  mkS("Meghraj medical","Medical Store",true,true,null,null,true,null,null,"",null,null,"Start"),
  mkS("Vijay stores","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Ashapura store","Kirana Store",true,true,null,null,true,null,true,"",null,null,"No Pitch Needed"),
  mkS("Store 1","Kirana Store",true,true,null,null,true,null,null,"",null,null,"End"),
  mkS("RSM medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Kohinoor medical","Medical Store",true,true,true,true,null,null,null,"","End","End"),
  mkS("Medical","Medical Store",true,true,null,null,true,null,true,"",null,null,"End"),
  mkS("Prince medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Health first medical","Medical Store",true,false,null,null,null,null,null,""),
  mkS("Gupta kirana store","General Store",true,true,null,null,null,null,null,""),
  mkS("Amit","General Store",true,false,null,null,null,null,null,""),
  mkS("Store 2","General Store",true,true,null,null,true,null,null,"",null,null,"No Pitch Needed"),
  mkS("Sandeep tobacco","Wholesaler",true,true,null,null,true,null,true,""),
];

const DAY8_STORES = [
  mkS("Pooja pan shop","Paan Shop",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Janta soap centre and retail","Wholesaler",true,true,null,true,null,null,null,"",null,"End"),
  mkS("Momaya kirana store","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Shri madhur chemist","Medical Store",true,false,null,null,null,null,null,"No order because delivery is delayed. They got the stock two days ago."),
  mkS("Vandhana kirana store","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Shree asha pura store","Kirana Store",true,true,null,null,null,null,true,""),
  mkS("Sidhvinayak super market","Kirana Store",true,true,null,true,null,null,null,"",null,"No Pitch Needed"),
  mkS("Sidhivinayak medical","Medical Store",true,true,null,true,null,null,true,"",null,"End"),
  mkS("Vidhyatri medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Jay Maharashtra","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Ganesh prasad store","General Store",true,true,null,null,true,null,null,""),
  mkS("Store 1","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Ganesh store","General Store",true,false,null,null,null,null,null,"Enough stock"),
  mkS("Super india oil shop","General Store",true,false,null,null,null,null,null,"Enough stock"),
  mkS("Dheenanath kirana","Kirana Store",true,false,null,null,null,null,null,"Enough stock"),
  mkS("Gala stores","General Store",true,true,null,null,null,null,null,""),
  mkS("Ansar general store","Wholesaler",true,true,null,null,null,null,null,""),
  mkS("Wellnes medical and general store","Medical Store",true,true,null,null,null,null,true,""),
  mkS("Star medical","Medical Store",true,true,null,null,null,null,null,"First time order this month"),
  mkS("Ambika general store","General Store",true,true,null,null,null,null,true,""),
  mkS("KGN General store","General Store",true,true,null,null,null,null,null,""),
  mkS("Anas general store","General Store",true,true,null,null,null,null,true,""),
  mkS("PAK store","General Store",true,true,null,true,null,null,null,"",null,"No Pitch Needed"),
  mkS("Mumbai medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Store","General Store",true,true,null,null,null,null,null,""),
  mkS("Chamunda","Medical Store",true,true,true,null,null,null,null,"","No Pitch Needed"),
];

const DAY9_STORES = [
  mkS("Sevadhari general store","General Store",true,false,null,null,null,null,null,"No order, no sale from last time order"),
  mkS("Shri satyam store","General Store",true,true,null,null,null,null,true,""),
  mkS("Ambika pan shop","Paan Shop",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Guru kripa mama banja general store","General Store",true,true,null,null,null,null,null,""),
  mkS("Pradeep chemist","Medical Store",true,true,null,true,null,null,true,""),
  mkS("Pappu panwala","Paan Shop",true,true,null,null,null,null,null,""),
  mkS("Paltan gupta kirana store","Kirana Store",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Bharat super market","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Shree nitianand","Paan Shop",true,true,null,true,null,null,null,"",null,"End"),
  mkS("New ajinkyatra","Medical Store",true,false,null,null,null,null,null,"No order enough stock"),
  mkS("Vaishnav kirana store","Kirana Store",true,false,null,null,null,null,null,""),
  mkS("Krishna medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Mathi general store","General Store",true,true,null,null,null,null,null,""),
  mkS("Eagle medical","Medical Store",true,false,null,null,null,null,null,""),
  mkS("Samrat medical and general store","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Shah popatlal","Kirana Store",true,true,null,null,null,null,true,""),
  mkS("Vijay supermarket","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Dhan lakshmi provision store","Kirana Store",true,true,null,null,null,null,true,""),
  mkS("Mahesh medico","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Shri balaji chemist","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Ambika medical","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Venkatra","Medical Store",true,true,null,null,null,null,true,""),
  mkS("Saraswati general store","General Store",true,true,null,null,null,null,true,""),
  mkS("Honesty medical and general store","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Store 1","Paan Shop",true,true,null,null,null,null,true,""),
  mkS("Sairaj","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Shree ganesh","Wholesaler",true,true,null,null,null,null,null,""),
  mkS("Ambika medical 2","Medical Store",true,true,null,null,null,null,true,""),
  mkS("Ansar general store","Wholesaler",true,true,null,null,null,null,null,""),
  mkS("Chandini","Medical Store",true,true,null,null,null,null,true,""),
];

const DAY10_STORES = [
  mkS("Maharashtra oil depot","General Store",true,true,null,true,null,null,null,""),
  mkS("Manohar","Kirana Store",true,true,null,null,null,null,true,""),
  mkS("Anwar ahmed grain shop","Kirana Store",true,true,null,null,null,null,true,""),
  mkS("New raj","Premium Medical Store",true,true,null,null,null,null,null,""),
  mkS("Shri krishna kirana store","Kirana Store",true,true,null,null,null,null,null,""),
  mkS("Kavita medical","Premium Medical Store",true,false,null,null,null,null,null,"No order"),
  mkS("Vijaylakshmi medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Vardhaman chemist","Premium Medical Store",true,true,null,null,null,null,null,""),
  mkS("Mahesh medical","Premium Medical Store",true,true,null,null,null,null,null,""),
  mkS("Shiv medical","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Pharmeasy","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Jeeshan anju bakery","General Store",true,true,null,null,null,null,true,""),
  mkS("Ankita store","Kirana Store",true,true,null,true,null,null,null,""),
  mkS("New health medico","Premium Medical Store",true,true,null,null,null,null,true,""),
  mkS("Sidhivinayak general stores","General Store",true,false,null,null,null,null,null,""),
  mkS("Store 1","General Store",true,false,null,null,null,null,null,""),
  mkS("Tauheed","Medical Store",true,true,null,null,null,null,true,""),
  mkS("New patel medical","Medical Store",true,false,null,null,null,null,null,"No order cause delivery on eid"),
  mkS("Store 1 medical","Medical Store",true,false,null,null,null,null,null,"No order because delivery on eid"),
  mkS("Geeta medical","Medical Store",true,true,true,null,null,null,null,"","Start"),
  mkS("Sidhi provision stores","General Store",true,true,null,null,null,null,null,""),
  mkS("Chamunda","Premium Medical Store",true,true,null,null,null,null,null,""),
  mkS("Mahalakshmi medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Ramesh medical","Medical Store",true,true,true,true,null,null,null,""),
  mkS("Mahalakshmi medical 2","Medical Store",true,true,null,true,null,null,null,""),
  mkS("Mumbai medical","Medical Store",true,true,null,null,null,null,null,""),
  mkS("Sunil medical","General Store",true,false,null,null,null,null,null,""),
  mkS("Rajendra kirana","Kirana Store",true,false,null,null,null,null,null,""),
  mkS("Vijay stores","General Store",true,false,null,null,null,null,null,""),
];

// Day 13 — 3 June, Waseem Khan (from Excel)
const DAY13_STORES = [
  mkJ("Kamgar grocery","SMT",true,true,{mf20rsRed:true,mf80gBlue:true,mfTdpRed:true},null,"Blue 80"),
  mkJ("Kamgar","SMT",true,true,{mf100gRed:true},null,""),
  mkJ("New Maharashtra store","Kirana Store",true,true,{mf20rsRed:true,mfTdpRed:true},null,""),
  mkJ("Laxmi medical","Medical Store",true,true,{sensitiveTbrs:true},null,""),
  mkJ("Regal","General Store",true,true,{mf150gBlue:true},null,"Blue 150g"),
  mkJ("Shah premchand kumbha","Medical Store",true,true,{mf20rsRed:true,mf80gRed:true,mf150gRed:true,mfTdpRed:true},null,""),
  mkJ("Om medical","Medical Store",true,true,{mf150gRed:true,mf150gBlue:true,mf80gBlue:true},null,"MF 150 Red, Blue 150, Blue 80"),
  mkJ("Bombay medical","Medical Store",true,false,{},null,"Delivery issue"),
  mkJ("Welcome medical","Medical Store",true,true,{},null,""),
  mkJ("Metro medical","Medical Store",true,true,{mf150gRed:true},null,""),
  mkJ("Shah traders","General Store",true,true,{},null,""),
  mkJ("Rashtra seva","General Store",true,true,{},null,""),
  mkJ("Star soap","General Store",true,true,{},null,""),
  mkJ("Mahim soap depot","General Store",true,true,{},null,""),
  mkJ("Narayan kirana store","Kirana Store",true,true,{mf20rsRed:true},null,""),
  mkJ("Royal","Medical Store",true,true,{mf20rsRed:true,mf150gRed:true},null,""),
  mkJ("Sonal soap","Medical Store",true,true,{},null,""),
  mkJ("Health forever","Medical Store",true,true,{},null,""),
  mkJ("Labella medical","Medical Store",true,false,{},null,""),
  mkJ("Ratanshi nenshi","Medical Store",true,true,{},null,""),
  mkJ("Kranti grain","Kirana Store",true,true,{mf20rsRed:true,mf150gRed:true},null,""),
  mkJ("Janta provision store","Kirana Store",true,false,{},null,""),
  mkJ("Vipul traders","Medical Store",true,false,{},null,""),
];

const DEFAULT_DAYS = [
  { id:"day-1",  label:"Day 1",  route:"",          date:"",       month:"may-2025", summaryOnly:true,  dayNotes:"", totals:{ visited:19,ordered:16,smtContracted:1,sensitiveTpOrdered:7,sensitiveTpMedical:2,medicalVisited:6,superFlexiOrdered:4,cdc200Ordered:0 }, stores:[] },
  { id:"day-2",  label:"Day 2",  route:"",          date:"",       month:"may-2025", summaryOnly:true,  dayNotes:"", totals:{ visited:25,ordered:20,smtContracted:0,sensitiveTpOrdered:7,sensitiveTpMedical:5,medicalVisited:5,superFlexiOrdered:9,cdc200Ordered:0 }, stores:[] },
  { id:"day-3",  label:"Day 3",  route:"Old Kharak",date:"15 May", month:"may-2025", summaryOnly:false, dayNotes:"According to the DSR, Sensitive TP is not selling as much because of Sensodyne — their marketing is stronger in this area.", stores:DAY3_STORES },
  { id:"day-4",  label:"Day 4",  route:"",          date:"16 May", month:"may-2025", summaryOnly:false, dayNotes:"All medical stores shut at 1pm. DSR does not take order because delivery always ends up getting returned.\n\nVery good effort on Super Flexi goal today.\n\nSensitive TP not great — few medical stores, either have stock already or it does not sell.", stores:DAY4_STORES },
  { id:"day-5",  label:"Day 5",  route:"",          date:"19 May", month:"may-2025", summaryOnly:false, dayNotes:"Heavy medical coverage day. Multiple wholesalers visited. Strong smile goal performance. CDC pushed well — Abhay grain and Neemchand both converted SF+CDC.", stores:DAY5_STORES },
  { id:"day-6",  label:"Day 6",  route:"", date:"20 May", month:"may-2025", summaryOnly:false, dayNotes:"100% conversion day — all 10 visited placed orders. Super Flexi was the star product.", stores:DAY6_STORES },
  { id:"day-7",  label:"Day 7",  route:"", date:"21 May", month:"may-2025", summaryOnly:false, dayNotes:"Strong CDC day — multiple conversions across medical and kirana stores. Kohinoor Medical converted both Sensitive TP and Super Flexi. A few no-orders due to sufficient stock.", stores:DAY7_STORES },
  { id:"day-8",  label:"Day 8",  route:"", date:"22 May", month:"may-2025", summaryOnly:false, dayNotes:"Good coverage with strong smile goal performance. Star Medical placed first-time order this month. Several stores had enough stock and did not order. Chamunda converted Sensitive TP.", stores:DAY8_STORES },
  { id:"day-9",  label:"Day 9",  route:"", date:"25 May", month:"may-2025", summaryOnly:false, dayNotes:"Strong medical and Super Flexi day. 7 Super Flexi conversions including paan shops. Smile goal achieved across 8 stores. Two wholesalers visited.", stores:DAY9_STORES },
  { id:"day-10", label:"Day 10", route:"", date:"26 May", month:"may-2025", summaryOnly:false, dayNotes:"Heavy premium medical coverage. Two stores declined orders due to Eid delivery conflict. Ramesh Medical converted both Sensitive TP and Super Flexi.", stores:DAY10_STORES },
  { id:"day-11", label:"Day 11", route:"", date:"",       month:"may-2025", summaryOnly:true,  dayNotes:"", totals:{ visited:0,ordered:0,smtContracted:0,sensitiveTpOrdered:0,sensitiveTpMedical:0,medicalVisited:0,superFlexiOrdered:0,cdc200Ordered:0 }, stores:[] },
  { id:"day-12", label:"Day 12", route:"", date:"",       month:"may-2025", summaryOnly:true,  dayNotes:"", totals:{ visited:0,ordered:0,smtContracted:0,sensitiveTpOrdered:0,sensitiveTpMedical:0,medicalVisited:0,superFlexiOrdered:0,cdc200Ordered:0 }, stores:[] },
  { id:"day-13", label:"Day 13", route:"", date:"3 Jun",  month:"june-2025",summaryOnly:false, dayNotes:"DSR: Waseem Khan", stores:DAY13_STORES },
  { id:"day-14", label:"Day 14", route:"", date:"4 Jun",  month:"june-2025",summaryOnly:true,  dayNotes:"DSR: Dattaram", totals:{ visited:42,ordered:24,smtContracted:0,mfTotal:29,sensitiveTbrs:1,medicalVisited:0,superFlexiOrdered:0,cdc200Ordered:0 }, stores:[] },
];

// ─── Stats ────────────────────────────────────────────────────────────────────
function dayStats(day) {
  if (day.summaryOnly) {
    const t = day.totals;
    return {
      visited:t.visited, ordered:t.ordered, medVisited:t.medicalVisited,
      sensitiveTpOrdered:t.sensitiveTpOrdered, sensitiveTpMedical:t.sensitiveTpMedical,
      superFlexi:t.superFlexiOrdered, cdc200:t.cdc200Ordered,
      smtTotal:t.smtContracted, smtContracted:t.smtContracted,
      noOrder:t.visited-t.ordered, total:t.visited,
      productCounts:{}, mfTotal:0, mfByVariant:{},
    };
  }
  const s = day.stores;
  const vis = s.filter(x=>x.visited);
  const med = s.filter(x=>isMedical(x.type));
  const smts = s.filter(x=>isSMT(x.type));

  if (day.month === "june-2025") {
    const mfByVariant = {};
    MF_VARIANTS.forEach(v => {
      mfByVariant[v.redKey]  = s.filter(x=>x[v.redKey]===true).length;
      mfByVariant[v.blueKey] = s.filter(x=>x[v.blueKey]===true).length;
    });
    const mfTotal = Object.values(mfByVariant).reduce((a,b)=>a+b,0);
    const tbrsSold = s.filter(x=>x.sensitiveTbrs===true).length;
    return {
      visited:vis.length, ordered:s.filter(x=>x.orderPlaced).length, total:s.length,
      medVisited:med.filter(x=>x.visited).length,
      smtTotal:smts.length, smtContracted:smts.filter(x=>x.smt_contract===true).length,
      noOrder:vis.filter(x=>!x.orderPlaced).length,
      mfTotal, mfByVariant, tbrsSold,
      productCounts:{ mfTotal, sensitiveTbrs:tbrsSold },
    };
  }

  // May
  const productCounts = {
    sensitiveSold:  s.filter(x=>x.sensitiveSold===true).length,
    superFlexiSold: s.filter(x=>x.superFlexiSold===true).length,
    cdc200Ordered:  s.filter(x=>x.cdc200Ordered===true).length,
  };
  return {
    visited:vis.length, ordered:s.filter(x=>x.orderPlaced).length, total:s.length,
    medVisited:med.filter(x=>x.visited).length,
    sensitiveTpOrdered:productCounts.sensitiveSold,
    sensitiveTpMedical:med.filter(x=>x.sensitiveSold===true).length,
    superFlexi:productCounts.superFlexiSold,
    cdc200:productCounts.cdc200Ordered,
    smtTotal:smts.length, smtContracted:smts.filter(x=>x.smt_contract===true).length,
    noOrder:vis.filter(x=>!x.orderPlaced).length,
    productCounts, mfTotal:0, mfByVariant:{},
  };
}

function pitchConversion(stores, productField, pitchField) {
  const results = {};
  PITCH_POSITIONS.forEach(pos => { results[pos] = { pitched:0, converted:0 }; });
  results[NO_PITCH] = { count:0 };
  stores.forEach(s => {
    const pitch = s[pitchField];
    if (!pitch) return;
    if (pitch === NO_PITCH) { results[NO_PITCH].count++; return; }
    if (results[pitch]) {
      results[pitch].pitched++;
      if (s[productField] === true) results[pitch].converted++;
    }
  });
  return results;
}

function mfPitchConversion(stores, pitchField) {
  // converted = store sold at least one MF variant
  const results = {};
  PITCH_POSITIONS.forEach(pos => { results[pos] = { pitched:0, converted:0 }; });
  results[NO_PITCH] = { count:0 };
  stores.forEach(s => {
    const pitch = s[pitchField];
    if (!pitch) return;
    const sold = storeMfCount(s) > 0;
    if (pitch === NO_PITCH) { results[NO_PITCH].count++; return; }
    if (results[pitch]) {
      results[pitch].pitched++;
      if (sold) results[pitch].converted++;
    }
  });
  return results;
}

// ─── UI Atoms ─────────────────────────────────────────────────────────────────
function SLabel({ text }) {
  return <div style={{ fontSize:11, color:C.muted, letterSpacing:1.5, textTransform:"uppercase", marginBottom:7, marginTop:16 }}>{text}</div>;
}
function SHead({ title, color }) {
  return <div style={{ fontSize:10, color:color||C.accent, letterSpacing:3, textTransform:"uppercase", marginTop:20, marginBottom:8, paddingBottom:6, borderBottom:`1px solid ${C.dim}` }}>{title}</div>;
}
function SRow({ label, val, color, sub }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.dim}` }}>
      <div>
        <div style={{ fontSize:14, color:C.muted }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{sub}</div>}
      </div>
      <span style={{ fontSize:16, fontWeight:700, color:color||C.text }}>{val}</span>
    </div>
  );
}
function Pill({ label, on, onClick, color }) {
  const c = color||C.accent;
  return (
    <button onClick={onClick} style={{ background:on?`${c}20`:C.card2, border:`1.5px solid ${on?c:C.border}`, borderRadius:99, color:on?c:C.muted, padding:"9px 18px", fontSize:14, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
      <span style={{ fontSize:16 }}>{on?"✓":"○"}</span>{label}
    </button>
  );
}
function Tri({ label, val, onChange, color }) {
  const c = color||C.accent;
  const cfg = val===null
    ? { icon:"?", txt:"–", col:C.muted, bg:C.card2, bdr:C.border }
    : val
    ? { icon:"✓", txt:"Yes", col:c, bg:`${c}18`, bdr:`${c}40` }
    : { icon:"✗", txt:"No", col:C.red, bg:`${C.red}10`, bdr:`${C.red}35` };
  return (
    <button onClick={()=>onChange(val===null?true:val?false:null)} style={{ background:cfg.bg, border:`1.5px solid ${cfg.bdr}`, borderRadius:99, color:cfg.col, padding:"9px 18px", fontSize:14, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
      <span style={{ fontSize:16 }}>{cfg.icon}</span>
      <span style={{ color:C.muted, fontSize:12 }}>{label}:</span>
      <span>{cfg.txt}</span>
    </button>
  );
}
function SmileToggle({ val, onChange }) {
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {[{v:true,icon:"😊",label:"Achieved",col:C.amber},{v:false,icon:"😞",label:"Missed",col:C.red},{v:null,icon:"☆",label:"Clear",col:C.muted}].map(o => (
        <button key={String(o.v)} onClick={()=>onChange(o.v)} style={{ background:val===o.v?`${o.col}20`:C.card2, border:`1.5px solid ${val===o.v?o.col:C.border}`, borderRadius:99, color:val===o.v?o.col:C.muted, padding:"9px 18px", fontSize:14, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span>{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}
function PitchSelector({ label, active, pitchVal, onChangePitch, color }) {
  if (!active) return null;
  const c = color||C.accent;
  return (
    <div style={{ marginTop:8, paddingLeft:4 }}>
      <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>📍 When did you pitch <span style={{ color:c }}>{label}</span>?</div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {[...PITCH_POSITIONS, NO_PITCH].map(pos => {
          const isNoPitch = pos === NO_PITCH;
          const isActive = pitchVal === pos;
          const btnColor = isNoPitch ? C.dim : c;
          return (
            <button key={pos} onClick={()=>onChangePitch(isActive?null:pos)} style={{ background:isActive?`${btnColor}20`:C.card2, border:`1.5px solid ${isActive?btnColor:C.border}`, borderRadius:99, color:isActive?btnColor:C.muted, padding:"7px 15px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              {isNoPitch ? "🤝 No pitch needed" : pos}
            </button>
          );
        })}
        {pitchVal && <button onClick={()=>onChangePitch(null)} style={{ background:"transparent", border:`1px dashed ${C.dim}`, borderRadius:99, color:C.dim, padding:"7px 12px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>✕ clear</button>}
      </div>
    </div>
  );
}
function PitchTable({ title, stores, productField, pitchField, color, isMf }) {
  const data = isMf ? mfPitchConversion(stores, pitchField) : pitchConversion(stores, productField, pitchField);
  const pitchedTotal = PITCH_POSITIONS.reduce((s,p)=>s+data[p].pitched,0);
  const noPitchCount = data[NO_PITCH]?.count || 0;
  if (pitchedTotal === 0 && noPitchCount === 0) return null;
  const c = color||C.accent;
  return (
    <div style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
      <div style={{ fontSize:12, fontWeight:700, color:c, marginBottom:10 }}>{title}</div>
      {PITCH_POSITIONS.map(pos => {
        const { pitched, converted } = data[pos];
        if (!pitched) return null;
        const rate = Math.round((converted/pitched)*100);
        const barColor = rate>=70?C.green:rate>=40?C.amber:C.red;
        return (
          <div key={pos} style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
              <span style={{ color:C.muted }}>{pos} of pitch</span>
              <span style={{ color:barColor, fontWeight:700 }}>{converted}/{pitched} = {rate}%</span>
            </div>
            <div style={{ background:C.dim, borderRadius:4, height:5, overflow:"hidden" }}>
              <div style={{ height:"100%", borderRadius:4, width:`${rate}%`, background:barColor, transition:"width .4s" }} />
            </div>
          </div>
        );
      })}
      {noPitchCount > 0 && (
        <div style={{ marginTop:6, fontSize:12, color:C.dim, borderTop:`1px solid ${C.dim}`, paddingTop:6 }}>
          🤝 No pitch needed: <span style={{ color:C.muted, fontWeight:700 }}>{noPitchCount} store{noPitchCount>1?"s":""}</span>
        </div>
      )}
    </div>
  );
}

// ─── MF Variant Row (Option B grouped UI) ────────────────────────────────────
function MFVariantRow({ sizeLabel, redKey, blueKey, store, set }) {
  const redVal  = store[redKey]  ?? null;
  const blueVal = store[blueKey] ?? null;
  return (
    <div style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
      <div style={{ fontSize:12, color:C.muted, marginBottom:8, fontWeight:600 }}>{sizeLabel}</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <Tri label="🔴 Red" val={redVal}  onChange={v=>set({[redKey]:v})}  color={C.redVariant} />
        <Tri label="🔵 Blue" val={blueVal} onChange={v=>set({[blueKey]:v})} color={C.blueVariant} />
      </div>
    </div>
  );
}

// ─── Store Card ───────────────────────────────────────────────────────────────
function StoreCard({ store, onChange, onDelete }) {
  const [open, setOpen] = useState(false);
  const set = patch => onChange({ ...store, ...patch });
  const borderColor = store.notOnVisit ? C.dim : store.visited ? (store.orderPlaced?C.green:C.amber) : C.border;
  const isJune = store.month === "june-2025";
  const mfSold = isJune ? storeMfCount(store) : 0;
  const anyMfPitched = isJune && (store.mfPitch !== null);

  return (
    <div style={{ background:C.card, border:`2px solid ${borderColor}`, borderRadius:14, marginBottom:10, overflow:"hidden", transition:"border-color .3s" }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ padding:"13px 15px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", userSelect:"none" }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:15, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{store.name||"Unnamed store"}</div>
          <div style={{ display:"flex", gap:7, marginTop:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:C.muted, background:C.bg, border:`1px solid ${C.border}`, borderRadius:5, padding:"1px 7px" }}>{store.type}</span>
            {store.notOnVisit && <span style={{ fontSize:11, color:C.dim }}>✗ not visiting</span>}
            {!store.notOnVisit && store.visited && <span style={{ fontSize:11, color:C.accent }}>✓ visited</span>}
            {store.orderPlaced && <span style={{ fontSize:11, color:C.green }}>✓ order</span>}
            {isJune && mfSold>0 && <span style={{ fontSize:11, color:C.accent }}>MF:{mfSold}</span>}
            {isJune && store.sensitiveTbrs===true && <span style={{ fontSize:11, color:C.purple }}>✓ TBRS</span>}
            {store.smileGoal===true && <span style={{ fontSize:13 }}>😊</span>}
            {store.smileGoal===false && <span style={{ fontSize:13 }}>😞</span>}
          </div>
        </div>
        <span style={{ color:C.muted, fontSize:20, marginLeft:10 }}>{open?"⌄":"›"}</span>
      </div>

      {open && (
        <div style={{ padding:"0 15px 16px", borderTop:`1px solid ${C.dim}` }}>
          <SLabel text="Store Name" />
          <input value={store.name} onChange={e=>set({name:e.target.value})} placeholder="Store name…" style={iS} />

          <SLabel text="Store Type" />
          <select value={store.type} onChange={e=>set({type:e.target.value})} style={{ ...iS, color:C.text }}>
            {STORE_TYPES.map(t=><option key={t} style={{ background:C.bg }}>{t}</option>)}
          </select>

          <SLabel text="Status" />
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Pill label="Visited" on={store.visited} onClick={()=>set({visited:!store.visited, notOnVisit:false})} color={C.accent} />
            <Pill label="Order Placed" on={store.orderPlaced} onClick={()=>set({orderPlaced:!store.orderPlaced})} color={C.green} />
            <Pill label="Not visiting" on={store.notOnVisit} onClick={()=>set({notOnVisit:!store.notOnVisit, visited:false, orderPlaced:false})} color={C.red} />
          </div>
          {store.notOnVisit && (
            <textarea value={store.notOnVisitReason||""} onChange={e=>set({notOnVisitReason:e.target.value})} placeholder="Why not visiting this store?" rows={2} style={{ ...iS, resize:"vertical", lineHeight:1.6, marginTop:8, border:`1px solid ${C.red}40` }} />
          )}

          {/* ── June Products ── */}
          {isJune && (
            <>
              <SLabel text="Max Fresh" />
              {MF_VARIANTS.map(v => (
                <MFVariantRow key={v.redKey} sizeLabel={v.sizeLabel} redKey={v.redKey} blueKey={v.blueKey} store={store} set={set} />
              ))}
              <div style={{ background:C.bg, border:`1px solid ${C.dim}`, borderRadius:10, padding:"10px 12px", marginTop:4, marginBottom:4 }}>
                <div style={{ fontSize:11, color:C.muted, letterSpacing:1.5, textTransform:"uppercase", marginBottom:4 }}>📍 MF Pitch Timing</div>
                <PitchSelector label="Max Fresh" active={true} pitchVal={store.mfPitch||null} onChangePitch={v=>set({mfPitch:v})} color={C.accent} />
              </div>

              <SLabel text="Sensitive TBRS" />
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <Tri label="Sensitive TBRS" val={store.sensitiveTbrs??null} onChange={v=>set({sensitiveTbrs:v, sensitiveTbrsPitch:v===null?null:store.sensitiveTbrsPitch})} color={C.purple} />
              </div>
              {(store.sensitiveTbrs??null) !== null && (
                <div style={{ background:C.bg, border:`1px solid ${C.dim}`, borderRadius:10, padding:"10px 12px", marginTop:8 }}>
                  <div style={{ fontSize:11, color:C.muted, letterSpacing:1.5, textTransform:"uppercase", marginBottom:4 }}>📍 TBRS Pitch Timing</div>
                  <PitchSelector label="Sensitive TBRS" active={true} pitchVal={store.sensitiveTbrsPitch||null} onChangePitch={v=>set({sensitiveTbrsPitch:v})} color={C.purple} />
                </div>
              )}
            </>
          )}

          {/* ── May Products ── */}
          {!isJune && (
            <>
              <SLabel text="Products" />
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <Tri label="Sensitive TP" val={store.sensitiveSold??null} onChange={v=>set({sensitiveSold:v, sensitivePitch:v===null?null:store.sensitivePitch})} color={C.purple} />
                <Tri label="Super Flexi"  val={store.superFlexiSold??null} onChange={v=>set({superFlexiSold:v, superFlexiPitch:v===null?null:store.superFlexiPitch})} color={C.cyan} />
                <Tri label="CDC 200g"     val={store.cdc200Ordered??null} onChange={v=>set({cdc200Ordered:v, cdcPitch:v===null?null:store.cdcPitch})} color={C.orange} />
                {isSMT(store.type) && <Tri label="Contract" val={store.smt_contract} onChange={v=>set({smt_contract:v})} color={C.amber} />}
              </div>
              {(store.sensitiveSold!==null || store.superFlexiSold!==null || store.cdc200Ordered!==null) && (
                <div style={{ background:C.bg, border:`1px solid ${C.dim}`, borderRadius:10, padding:"10px 12px", marginTop:10 }}>
                  <div style={{ fontSize:11, color:C.muted, letterSpacing:1.5, textTransform:"uppercase", marginBottom:4 }}>📍 Pitch Timing</div>
                  <PitchSelector label="Sensitive TP" active={store.sensitiveSold!==null} pitchVal={store.sensitivePitch} onChangePitch={v=>set({sensitivePitch:v})} color={C.purple} />
                  <PitchSelector label="Super Flexi"  active={store.superFlexiSold!==null} pitchVal={store.superFlexiPitch} onChangePitch={v=>set({superFlexiPitch:v})} color={C.cyan} />
                  <PitchSelector label="CDC 200g"     active={store.cdc200Ordered!==null} pitchVal={store.cdcPitch} onChangePitch={v=>set({cdcPitch:v})} color={C.orange} />
                </div>
              )}
            </>
          )}

          <SLabel text="😊 Smile Goal" />
          <SmileToggle val={store.smileGoal} onChange={v=>set({smileGoal:v})} />

          {store.visited && !store.orderPlaced && (
            <div style={{ marginTop:10 }}>
              <SLabel text="Why no order?" />
              <select value={store.noOrderReason||""} onChange={e=>set({noOrderReason:e.target.value, noOrderReasonOther:""})}
                style={{ ...iS, color:store.noOrderReason?C.text:C.muted }}>
                <option value="">Select reason…</option>
                <option value="Enough stock">Enough stock</option>
                <option value="Owner not present">Owner not present</option>
                <option value="Shop closed / on strike">Shop closed / on strike</option>
                <option value="Delivery timing conflict">Delivery timing conflict (holiday/festive)</option>
                <option value="Out of stock at distributor">Out of stock at distributor</option>
                <option value="Price / margin issue">Price / margin issue</option>
                <option value="Other">Other</option>
              </select>
              {store.noOrderReason === "Other" && (
                <textarea value={store.noOrderReasonOther||""} onChange={e=>set({noOrderReasonOther:e.target.value})}
                  placeholder="Describe reason…" rows={2} style={{ ...iS, resize:"vertical", lineHeight:1.6, marginTop:6 }} />
              )}
            </div>
          )}

          <SLabel text="Store Notes" />
          <textarea value={store.notes} onChange={e=>set({notes:e.target.value})} placeholder="Any notes…" rows={2} style={{ ...iS, resize:"vertical", lineHeight:1.6 }} />

          <button onClick={()=>onDelete(store.id)} style={{ background:`${C.red}15`, border:`1px solid ${C.red}40`, borderRadius:10, color:C.red, padding:"10px 0", fontSize:13, cursor:"pointer", fontFamily:"inherit", width:"100%", marginTop:14 }}>
            Delete Store
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Day Summary ──────────────────────────────────────────────────────────────
function DaySummary({ day }) {
  const st = dayStats(day);
  const isJune = day.month === "june-2025";
  const hit = st.ordered >= DAILY_TARGET;
  const smileY = day.stores.filter(s=>s.smileGoal===true).length;
  const smileN = day.stores.filter(s=>s.smileGoal===false).length;

  return (
    <div>
      <div style={{ background:hit?`${C.green}08`:`${C.amber}08`, border:`2px solid ${hit?C.green:C.amber}30`, borderRadius:14, padding:18, marginBottom:18, textAlign:"center" }}>
        <div style={{ fontSize:32 }}>{hit?"🎯":"⏳"}</div>
        <div style={{ fontSize:18, fontWeight:800, color:hit?C.green:C.amber, marginTop:6 }}>{hit?"Target Hit!":"Target Not Reached"}</div>
        <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{st.ordered} / {DAILY_TARGET} bill cuts</div>
      </div>

      <SHead title="Coverage" />
      <SRow label="Stores on route" val={st.total||"—"} />
      <SRow label="Visited" val={st.visited} color={C.accent} />
      <SRow label="Orders placed" val={`${st.ordered} / ${st.visited}`} color={C.green} />
      <SRow label="No order" val={st.noOrder} color={st.noOrder>0?C.amber:C.green} />

      {isJune ? (
        <>
          <SHead title="Max Fresh (MF TDP)" color={C.accent} />
          <SRow label="Total MF units sold" val={st.mfTotal} color={C.accent} />
          {MF_VARIANTS.map(v => (
            <div key={v.redKey}>
              <SRow label={`${v.sizeLabel} — Red`}  val={st.mfByVariant?.[v.redKey]||0}  color={C.redVariant} />
              <SRow label={`${v.sizeLabel} — Blue`} val={st.mfByVariant?.[v.blueKey]||0} color={C.blueVariant} />
            </div>
          ))}
          <SHead title="Sensitive TBRS" color={C.purple} />
          <SRow label="Sensitive TBRS sold" val={st.tbrsSold||0} color={C.purple} />
        </>
      ) : (
        <>
          <SHead title="GTM Products" color={C.purple} />
          <SRow label="Sensitive TP ordered" val={st.sensitiveTpOrdered||0} color={C.purple} />
          <SRow label="  of which medical"   val={`${st.sensitiveTpMedical||0}/${st.medVisited} med visited`} color={C.purple} sub="GTM target" />
          <SRow label="Super Flexi ordered"  val={`${st.superFlexi||0}/${st.visited}`} color={C.cyan} />
          <SRow label="CDC 200g ordered"     val={st.cdc200||0} color={C.orange} />
        </>
      )}

      {st.smtTotal>0 && (
        <>
          <SHead title="SMT" color={C.amber} />
          <SRow label="Contracted" val={`${st.smtContracted}/${st.smtTotal}`} color={C.amber} />
        </>
      )}

      <SHead title="😊 Smile Goal" color={C.amber} />
      {smileY+smileN>0
        ? <><SRow label="Achieved" val={smileY} color={C.green} /><SRow label="Missed" val={smileN} color={C.red} /></>
        : <div style={{ fontSize:13, color:C.dim, padding:"10px 0" }}>Mark smile goal on each store card.</div>
      }

      {!day.summaryOnly && day.stores.length>0 && (
        <>
          <SHead title="📍 Pitch Timing — Conversion Rates" color={C.accent} />
          {isJune ? (
            <>
              <PitchTable title="Max Fresh (all variants)" stores={day.stores} pitchField="mfPitch" color={C.accent} isMf={true} />
              <PitchTable title="Sensitive TBRS" stores={day.stores} productField="sensitiveTbrs" pitchField="sensitiveTbrsPitch" color={C.purple} isMf={false} />
            </>
          ) : (
            <>
              <PitchTable title="Sensitive TP" stores={day.stores} productField="sensitiveSold"  pitchField="sensitivePitch"  color={C.purple} />
              <PitchTable title="Super Flexi"  stores={day.stores} productField="superFlexiSold" pitchField="superFlexiPitch" color={C.cyan} />
              <PitchTable title="CDC 200g"     stores={day.stores} productField="cdc200Ordered"  pitchField="cdcPitch"        color={C.orange} />
            </>
          )}
        </>
      )}

      {day.dayNotes ? (
        <div style={{ marginTop:18, background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"13px 15px" }}>
          <SHead title="📝 Day Notes" />
          <div style={{ fontSize:14, color:C.text, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{day.dayNotes}</div>
        </div>
      ) : null}

      {!day.summaryOnly && day.stores.length>0 && (
        <>
          <SHead title="Store Breakdown" />
          {day.stores.map(s => {
            const mf = storeMfCount(s);
            return (
              <div key={s.id} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 13px", marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{s.name||"Unnamed"}</span>
                    <span style={{ fontSize:11, color:C.muted, marginLeft:7 }}>{s.type}</span>
                  </div>
                  {s.smileGoal!==null && <span style={{ fontSize:18 }}>{s.smileGoal?"😊":"😞"}</span>}
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:6 }}>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, background:s.visited?`${C.green}12`:`${C.red}10`, color:s.visited?C.green:C.red, border:`1px solid ${s.visited?`${C.green}30`:`${C.red}25`}` }}>{s.visited?"✓":"✗"} Visit</span>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, background:s.orderPlaced?`${C.green}12`:`${C.red}10`, color:s.orderPlaced?C.green:C.red, border:`1px solid ${s.orderPlaced?`${C.green}30`:`${C.red}25`}` }}>{s.orderPlaced?"✓":"✗"} Order</span>
                  {isJune && mf>0 && <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, background:`${C.accent}12`, color:C.accent, border:`1px solid ${C.accent}30` }}>MF: {mf}</span>}
                  {isJune && s.sensitiveTbrs===true && <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, background:`${C.purple}12`, color:C.purple, border:`1px solid ${C.purple}30` }}>✓ TBRS</span>}
                  {!isJune && [["Sensitive",s.sensitiveSold],["Flexi",s.superFlexiSold],["CDC",s.cdc200Ordered]].map(([l,v])=>(
                    <span key={l} style={{ fontSize:11, padding:"2px 8px", borderRadius:6, background:v===null?C.card2:v?`${C.green}12`:`${C.red}10`, color:v===null?C.dim:v?C.green:C.red, border:`1px solid ${v===null?C.border:v?`${C.green}30`:`${C.red}25`}` }}>
                      {v===null?"?":v?"✓":"✗"} {l}
                    </span>
                  ))}
                </div>
                {s.notes ? <div style={{ fontSize:12, color:C.dim, marginTop:6, lineHeight:1.5 }}>📝 {s.notes}</div> : null}
                {s.noOrderReason ? <div style={{ fontSize:12, color:C.amber, marginTop:4 }}>⚠ {s.noOrderReason}</div> : null}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────
function WeekView({ days, activeMonth }) {
  const isJune = activeMonth === "june-2025";
  const complete = days.filter(d=>d.month===activeMonth && dayStats(d).visited>0);
  const n = complete.length;
  if (!n) return <div style={{ color:C.muted, textAlign:"center", padding:40, fontSize:14 }}>No data yet for {MONTHS[activeMonth].label}.</div>;
  const all = complete.map(dayStats);
  const sum = f => all.reduce((s,x)=>s+(x[f]||0),0);
  const sumMfVariant = key => all.reduce((s,x)=>s+(x.mfByVariant?.[key]||0),0);
  const allStores = complete.filter(d=>!d.summaryOnly).flatMap(d=>d.stores);

  return (
    <div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:18 }}>
        {isJune ? [
          ["Days",   n,               C.accent],
          ["Visits", sum("visited"),   C.accent],
          ["Orders", sum("ordered"),   C.green],
          ["MF TDP", sum("mfTotal"),   C.accent],
          ["TBRS",   sum("tbrsSold"),  C.purple],
        ] : [
          ["Days",   n,                           C.accent],
          ["Visits", sum("visited"),               C.accent],
          ["Orders", sum("ordered"),               C.green],
          ["Sens",   sum("sensitiveTpOrdered"),    C.purple],
          ["Flexi",  sum("superFlexi"),            C.cyan],
          ["CDC",    sum("cdc200"),                C.orange],
        ].map(([l,v,c])=>(
          <div key={l} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 8px", flex:1, minWidth:55, textAlign:"center" }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>{l}</div>
            <div style={{ fontSize:20, fontWeight:900, color:c }}>{v}</div>
          </div>
        ))}
        {isJune && [
          ["Days",   n,               C.accent],
          ["Visits", sum("visited"),   C.accent],
          ["Orders", sum("ordered"),   C.green],
          ["MF TDP", sum("mfTotal"),   C.accent],
          ["TBRS",   sum("tbrsSold"),  C.purple],
        ].map(([l,v,c])=>(
          <div key={l} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 8px", flex:1, minWidth:55, textAlign:"center" }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>{l}</div>
            <div style={{ fontSize:20, fontWeight:900, color:c }}>{v}</div>
          </div>
        ))}
      </div>

      {isJune && (
        <>
          <SHead title="MF Variant Breakdown" color={C.accent} />
          {MF_VARIANTS.map(v=>(
            <div key={v.redKey}>
              <SRow label={`${v.sizeLabel} Red`}  val={sumMfVariant(v.redKey)}  color={C.redVariant} />
              <SRow label={`${v.sizeLabel} Blue`} val={sumMfVariant(v.blueKey)} color={C.blueVariant} />
            </div>
          ))}
          <SRow label="Sensitive TBRS" val={sum("tbrsSold")} color={C.purple} />
        </>
      )}

      {!isJune && (
        <>
          <SHead title="Averages per day" />
          <SRow label="Avg visited"       val={(sum("visited")/n).toFixed(1)}           color={C.accent} />
          <SRow label="Avg orders"        val={(sum("ordered")/n).toFixed(1)}            color={C.green} />
          <SRow label="Avg Sensitive TP"  val={(sum("sensitiveTpOrdered")/n).toFixed(1)} color={C.purple} />
          <SRow label="Avg Super Flexi"   val={(sum("superFlexi")/n).toFixed(1)}         color={C.cyan} />
          <SRow label="Avg CDC 200g"      val={(sum("cdc200")/n).toFixed(1)}             color={C.orange} />
        </>
      )}

      {allStores.length>0 && (
        <>
          <SHead title="📍 Pitch Timing — Weekly Analysis" color={C.accent} />
          {isJune ? (
            <>
              <PitchTable title="Max Fresh (all variants)" stores={allStores} pitchField="mfPitch" color={C.accent} isMf={true} />
              <PitchTable title="Sensitive TBRS" stores={allStores} productField="sensitiveTbrs" pitchField="sensitiveTbrsPitch" color={C.purple} isMf={false} />
            </>
          ) : (
            <>
              <PitchTable title="Sensitive TP" stores={allStores} productField="sensitiveSold"  pitchField="sensitivePitch"  color={C.purple} />
              <PitchTable title="Super Flexi"  stores={allStores} productField="superFlexiSold" pitchField="superFlexiPitch" color={C.cyan} />
              <PitchTable title="CDC 200g"     stores={allStores} productField="cdc200Ordered"  pitchField="cdcPitch"        color={C.orange} />
            </>
          )}
        </>
      )}

      <SHead title="Day-by-Day" />
      {complete.map(d => {
        const st = dayStats(d);
        const hit = st.ordered>=DAILY_TARGET;
        return (
          <div key={d.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 15px", marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
              <span style={{ fontWeight:700, fontSize:16, color:C.text }}>{d.label}</span>
              <span style={{ fontSize:13, color:hit?C.green:C.red, fontWeight:700 }}>{hit?"✓":"✗"} {st.ordered} orders</span>
            </div>
            {d.route && <div style={{ fontSize:12, color:C.muted, marginBottom:5 }}>📍 {d.route}</div>}
            {d.date  && <div style={{ fontSize:11, color:C.dim,   marginBottom:5 }}>{d.date}</div>}
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, color:C.accent }}>{st.visited} visited</span>
              {isJune
                ? <><span style={{ fontSize:13, color:C.accent }}>MF: {st.mfTotal}</span><span style={{ fontSize:13, color:C.purple }}>TBRS: {st.tbrsSold||0}</span></>
                : <><span style={{ fontSize:13, color:C.purple }}>{st.sensitiveTpOrdered||0} sens</span><span style={{ fontSize:13, color:C.cyan }}>{st.superFlexi||0} flexi</span><span style={{ fontSize:13, color:C.orange }}>{st.cdc200||0} CDC</span></>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [days, setDays] = useState(null);
  const [activeMonth, setActiveMonth] = useState("may-2025");
  const [idx, setIdx] = useState(0);
  const [tab, setTab] = useState("stores");
  const [saveStatus, setSaveStatus] = useState("loading");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("General Store");
  const debounce = useRef(null);

  useEffect(() => {
    loadFromSupabase(DEFAULT_DAYS).then(d => {
      setDays(d);
      const lastMay = [...d].map((x,i)=>({x,i})).filter(({x})=>x.month==="may-2025").pop();
      setIdx(lastMay ? lastMay.i : d.length-1);
      setSaveStatus("saved");
    });
  }, []);

  const commit = newDays => {
    setDays(newDays);
    setSaveStatus("saving");
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const ok = await saveToSupabase(newDays);
      setSaveStatus(ok ? "saved" : "error");
    }, 800);
  };

  if (!days) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
      <div style={{ fontSize:32 }}>📋</div>
      <div style={{ color:C.accent, fontSize:14, fontFamily:"monospace" }}>Syncing with cloud…</div>
    </div>
  );

  const monthDays = days.filter(d=>d.month===activeMonth);
  const day = days[idx];
  const isJune = activeMonth === "june-2025";
  const st = day ? dayStats(day) : null;
  const hit = st ? st.ordered >= DAILY_TARGET : false;
  const pct = st ? Math.min((st.ordered/DAILY_TARGET)*100, 100) : 0;

  const updateDay   = patch => commit(days.map((d,i)=>i===idx?{...d,...patch}:d));
  const updateStore = updated => commit(days.map((d,i)=>i!==idx?d:{...d,stores:d.stores.map(s=>s.id===updated.id?updated:s)}));
  const deleteStore = id => commit(days.map((d,i)=>i!==idx?d:{...d,stores:d.stores.filter(s=>s.id!==id)}));

  const addStore = () => {
    const productFields = isJune ? emptyJuneFields() : emptyMayFields();
    const s = {
      id:uid(), name:newName, type:newType, visited:false, orderPlaced:false,
      month:activeMonth, smt_contract:null, smileGoal:null, notes:"",
      notOnVisit:false, notOnVisitReason:"", noOrderReason:"", noOrderReasonOther:"",
      ...productFields,
    };
    commit(days.map((d,i)=>i!==idx?d:{...d,stores:[...d.stores,s]}));
    setNewName(""); setNewType("General Store"); setShowAdd(false);
  };

  const addDay = () => {
    const nd = {
      id:uid(), label:`Day ${days.length+1}`, route:"",
      date:new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short"}),
      month:activeMonth, summaryOnly:false, dayNotes:"", stores:[],
    };
    const next = [...days, nd];
    commit(next); setIdx(next.length-1); setTab("stores");
  };

  const resetCheckins = () => {
    if (!window.confirm("Reset all check-ins? Names stay.")) return;
    const productFields = isJune ? emptyJuneFields() : emptyMayFields();
    commit(days.map((d,i)=>i!==idx?d:{...d,stores:d.stores.map(s=>({
      ...s, visited:false, orderPlaced:false, smt_contract:null, smileGoal:null,
      notes:"", notOnVisit:false, notOnVisitReason:"", noOrderReason:"", noOrderReasonOther:"",
      ...productFields,
    }))}));
  };

  const handleMonthSwitch = m => {
    setActiveMonth(m);
    setTab("stores");
    const mDays = days.map((d,i)=>({d,i})).filter(({d})=>d.month===m);
    if (mDays.length > 0) setIdx(mDays[mDays.length-1].i);
  };

  const saveDotColor = saveStatus==="saved"?C.green:saveStatus==="saving"?C.amber:C.red;
  const saveDotLabel = saveStatus==="saved"?"☁ synced":saveStatus==="saving"?"syncing…":"⚠ sync error";

  // stat tiles for stores view
  const statTiles = isJune
    ? [["Visited",st?.visited,`of ${day?.stores?.length||0}`,C.accent],["Orders",st?.ordered,`min ${DAILY_TARGET}`,hit?C.green:C.red],["MF",st?.mfTotal||0,"",C.accent],["TBRS",st?.tbrsSold||0,"",C.purple]]
    : [["Visited",st?.visited,`of ${day?.stores?.length||0}`,C.accent],["Orders",st?.ordered,`min ${DAILY_TARGET}`,hit?C.green:C.red],["Flexi",st?.superFlexi||0,"",C.cyan],["Sens",st?.sensitiveTpOrdered||0,"",C.purple],["CDC",st?.cdc200||0,"",C.orange]];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding:"16px 14px 80px", maxWidth:500, margin:"0 auto" }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
        <div>
          <div style={{ fontSize:10, color:C.accent, letterSpacing:3, textTransform:"uppercase", marginBottom:2 }}>Colgate · Field</div>
          <div style={{ fontSize:24, fontWeight:800, lineHeight:1 }}>Market Visits</div>
        </div>
        <div style={{ textAlign:"right", paddingTop:4 }}>
          <div style={{ fontSize:11, color:saveDotColor, fontWeight:600 }}>{saveDotLabel}</div>
          <div style={{ fontSize:11, color:C.dim, marginTop:3 }}>{days.length} days</div>
        </div>
      </div>

      {/* Month switcher */}
      <div style={{ display:"flex", gap:6, marginBottom:14, background:C.card, borderRadius:12, padding:4 }}>
        {Object.entries(MONTHS).map(([key,m]) => (
          <button key={key} onClick={()=>handleMonthSwitch(key)} style={{ flex:1, padding:"10px 0", border:"none", borderRadius:9, background:activeMonth===key?C.accent:"transparent", color:activeMonth===key?"#fff":C.muted, fontSize:13, fontWeight:activeMonth===key?700:400, cursor:"pointer", fontFamily:"inherit" }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Day tabs */}
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:6, marginBottom:16, WebkitOverflowScrolling:"touch" }}>
        {days.map((d,i) => {
          if (d.month !== activeMonth) return null;
          return (
            <button key={d.id} onClick={()=>{setIdx(i);setTab("stores");}}
              style={{ background:idx===i&&tab!=="week"?C.accent:C.card, border:`1px solid ${idx===i&&tab!=="week"?C.accent:C.border}`, borderRadius:10, color:idx===i&&tab!=="week"?"#fff":C.muted, padding:"9px 16px", fontSize:13, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0, fontWeight:idx===i&&tab!=="week"?700:400 }}>
              {d.label}
            </button>
          );
        })}
        <button onClick={addDay} style={{ background:"transparent", border:`1px dashed ${C.dim}`, borderRadius:10, color:C.dim, padding:"9px 16px", fontSize:13, cursor:"pointer", fontFamily:"inherit", flexShrink:0, whiteSpace:"nowrap" }}>
          + Day {monthDays.length+1}
        </button>
        <button onClick={()=>setTab("week")} style={{ background:tab==="week"?`${C.purple}20`:"transparent", border:`1px solid ${tab==="week"?C.purple:C.dim}`, borderRadius:10, color:tab==="week"?C.purple:C.dim, padding:"9px 16px", fontSize:13, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
          📊 Week
        </button>
      </div>

      {tab==="week" && <WeekView days={days} activeMonth={activeMonth} />}

      {tab!=="week" && day && (
        <div>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:15, marginBottom:14 }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:14 }}>
              {day.label}
              {day.date && <span style={{ fontSize:13, color:C.muted, fontWeight:400, marginLeft:10 }}>{day.date}</span>}
            </div>
            <SLabel text="Route / Area" />
            <input value={day.route||""} onChange={e=>updateDay({route:e.target.value})} placeholder="e.g. Matunga, Sion…" style={iS} />
            <SLabel text="📝 Day Notes (optional)" />
            <textarea value={day.dayNotes||""} onChange={e=>updateDay({dayNotes:e.target.value})} placeholder="Market observations, competitor activity…" rows={3} style={{ ...iS, resize:"vertical", lineHeight:1.6 }} />
          </div>

          <div style={{ display:"flex", gap:3, marginBottom:14, background:C.card, borderRadius:12, padding:4 }}>
            {[["stores","🏪 Stores"],["summary","📋 Summary"]].map(([k,l]) => (
              <button key={k} onClick={()=>setTab(k)} style={{ flex:1, padding:"11px 0", border:"none", borderRadius:9, background:tab===k?C.bg:"transparent", color:tab===k?C.text:C.muted, fontSize:14, cursor:"pointer", fontFamily:"inherit", fontWeight:tab===k?700:400 }}>{l}</button>
            ))}
          </div>

          {day.summaryOnly && tab==="stores" && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
              <div style={{ fontSize:13, color:C.amber, marginBottom:14, background:`${C.amber}10`, border:`1px solid ${C.amber}30`, borderRadius:10, padding:"10px 13px" }}>
                ⚠ {day.label} recorded from memory.
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
                {[["Visited",day.totals.visited,C.accent],["Orders",day.totals.ordered,C.green],["Sens TP",day.totals.sensitiveTpOrdered,C.purple],["Flexi",day.totals.superFlexiOrdered,C.cyan]].map(([l,v,c]) => (
                  <div key={l} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 14px", flex:1, minWidth:70, textAlign:"center" }}>
                    <div style={{ fontSize:9, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>{l}</div>
                    <div style={{ fontSize:24, fontWeight:900, color:c }}>{v}</div>
                  </div>
                ))}
              </div>
              <SLabel text="Edit Totals" />
              {[["visited","Stores Visited"],["ordered","Orders Placed"],["medicalVisited","Medical Visited"],["sensitiveTpOrdered","Sensitive TP Ordered"],["sensitiveTpMedical","  of which Medical"],["superFlexiOrdered","Super Flexi Ordered"],["cdc200Ordered","CDC 200g Ordered"],["smtContracted","SMT Contracted"]].map(([f,l]) => (
                <div key={f} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:`1px solid ${C.dim}` }}>
                  <span style={{ fontSize:14, color:C.muted }}>{l}</span>
                  <input type="number" min={0} value={day.totals[f]} onChange={e=>updateDay({totals:{...day.totals,[f]:parseInt(e.target.value)||0}})} style={{ ...iS, width:70, textAlign:"center", padding:"8px 6px" }} />
                </div>
              ))}
            </div>
          )}

          {!day.summaryOnly && tab==="stores" && st && (
            <div>
              <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
                {statTiles.map(([l,v,sub,c]) => (
                  <div key={l} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"11px 8px", flex:1, minWidth:52 }}>
                    <div style={{ fontSize:9, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:20, fontWeight:900, color:c||C.text, lineHeight:1 }}>{v??0}</div>
                    {sub ? <div style={{ fontSize:9, color:C.dim, marginTop:2 }}>{sub}</div> : null}
                  </div>
                ))}
              </div>

              <div style={{ marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:C.muted, marginBottom:5 }}>
                  <span>Bill cuts</span>
                  <span style={{ color:hit?C.green:C.amber, fontWeight:700 }}>{hit?"✓ Target hit!":`${DAILY_TARGET-(st.ordered||0)} to go`}</span>
                </div>
                <div style={{ background:C.dim, borderRadius:6, height:7, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:6, width:`${pct}%`, background:hit?C.green:`linear-gradient(90deg,${C.accent},${C.purple})`, transition:"width .5s" }} />
                </div>
              </div>

              {day.stores.length===0 && <div style={{ textAlign:"center", color:C.dim, padding:"36px 0", fontSize:14 }}>No stores yet. Add your first one below.</div>}
              {day.stores.map(s => <StoreCard key={s.id} store={s} onChange={updateStore} onDelete={deleteStore} />)}

              {showAdd ? (
                <div style={{ background:C.card, border:`1px dashed ${C.border}`, borderRadius:14, padding:16, marginTop:4 }}>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>New Store</div>
                  <SLabel text="Store Name" />
                  <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Store name (optional)…" style={{ ...iS, marginBottom:4 }} autoFocus onKeyDown={e=>e.key==="Enter"&&addStore()} />
                  <SLabel text="Store Type" />
                  <select value={newType} onChange={e=>setNewType(e.target.value)} style={{ ...iS, color:C.text, marginBottom:16 }}>
                    {STORE_TYPES.map(t=><option key={t} style={{ background:C.bg }}>{t}</option>)}
                  </select>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={addStore} style={{ flex:1, background:`${C.green}18`, border:`1px solid ${C.green}40`, borderRadius:10, color:C.green, padding:"12px 0", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>+ Add</button>
                    <button onClick={()=>setShowAdd(false)} style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, color:C.muted, padding:"12px 0", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={()=>setShowAdd(true)} style={{ width:"100%", background:"transparent", border:`1.5px dashed ${C.dim}`, borderRadius:14, color:C.dim, padding:"14px 0", fontSize:14, cursor:"pointer", fontFamily:"inherit", marginTop:4 }}>
                  + Add Store
                </button>
              )}
              <button onClick={resetCheckins} style={{ width:"100%", background:"transparent", border:`1px solid ${C.dim}`, borderRadius:10, color:C.dim, padding:"10px 0", fontSize:12, cursor:"pointer", fontFamily:"inherit", marginTop:8 }}>
                ↺ Reset check-ins
              </button>
            </div>
          )}

          {tab==="summary" && <DaySummary day={day} />}
        </div>
      )}
    </div>
  );
}
