import { useState, useRef, useEffect } from "react";
import { dbReadAll, dbWriteEntry, dbDeleteEntry, dbUpdateEntry } from "./storage.js";

// ─── RISK CALCULATORS ─────────────────────────────────────────────────────────
function calcRCRI(f) {
  const score = [f.highRiskSurgery, f.ischemicHeartDisease, f.heartFailure, f.cerebrovascularDisease, f.insulinDependentDiabetes, f.creatinineAbove2].filter(Boolean).length;
  const [risk, pct] = score === 0 ? ["Very Low","<1%"] : score === 1 ? ["Low","~1%"] : score === 2 ? ["Intermediate","~2.4%"] : ["High","≥5.4%"];
  return { score, risk, pct };
}

function calcARISCAT(f) {
  let score = 0;
  if (f.spo2_lt95) score += 24; else if (f.spo2_95_98) score += 8;
  if (f.respiratoryInfectionLastMonth) score += 17;
  if (f.anemia) score += 11;
  if (f.upperAbdominalOrThoracic) score += 15;
  if (f.surgeryOver2hrs) score += 16;
  if (f.emergencySurgery) score += 8;
  const risk = score < 26 ? "Low (<1.6%)" : score < 44 ? "Intermediate (13.3%)" : "High (42.1%)";
  return { score, risk };
}

function calcSTOPBANG(f) {
  const score = [f.snoring, f.tired, f.observed, f.pressure, f.bmi35, f.ageOver50, f.neckOver40, f.male].filter(Boolean).length;
  const risk = score <= 2 ? "Low OSA Risk" : score <= 4 ? "Intermediate OSA Risk" : "High OSA Risk";
  return { score, risk };
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function buildSystemPrompt(scores) {
  return `You are an expert consultant anaesthesiologist with 25+ years of experience at a major tertiary centre. You reason exactly like a senior consultant — not like a chatbot.

CRITICAL RULES (addressing GPT-4.0 failures from BJA 2025):
1. NEVER default to GA without comparing ALL techniques (GA, Regional, Combined, Neuraxial)
2. ALWAYS assess aspiration risk — if elevated → RSI + cuffed ETT mandatory, NEVER recommend SAD
3. ALWAYS consider locoregional: epidurals for thoracic/upper abdominal, nerve blocks for orthopaedic, spinals for lower limb/obstetric
4. ALWAYS follow ERAS principles for upper GI, colorectal, thoracic surgery
5. NEVER omit multimodal analgesia — paracetamol alone is INSUFFICIENT for major surgery
6. Cardiopulmonary risk must be explicit with reasoning
7. ASA-PS: independently assess and compare with user-provided grade, flag discrepancies
8. Fluid management must be individualised

Pre-calculated scores:
${scores}

OUTPUT FORMAT — all 12 stages:

## 🔴 Stage 1: Risk Stratification & ASA-PS
**Cardiac Risk (RCRI):** [score and category] — [justification]
**Pulmonary Risk (ARISCAT):** [score and category] — [justification]
**OSA Risk (STOP-BANG):** [score and category]
**Aspiration Risk:** [Low/Moderate/HIGH] — [reasoning]
**Airway Assessment:** [Expected easy/Potentially difficult/Anticipated difficult] — [reasoning]
**Functional Status:** [METs estimate]
**User-provided ASA-PS:** [grade] | **AI-assessed ASA-PS:** [independent assessment] | **Agreement:** [Yes/No — explain if No]

## ✈️ Stage 2: Anaesthetic Technique Options
**Option A:** [Technique] — Pros: [...] Cons: [...]
**Option B:** [Technique] — Pros: [...] Cons: [...]
**Preferred Technique:** [chosen] — **Justification:** [reasoning]

## 🫁 Stage 3: Airway Plan
**Primary Plan:** [device + technique]
**Why:** [reasoning]
**Backup Plan:** [VL/bougie/FONA]
**RSI indicated?** [Yes/No — explicit reasoning]

## 📊 Stage 4: Monitoring Plan
- Standard ASA monitoring: ✅ Always
- Arterial line: [✅/❌] — [reason]
- Central venous catheter: [✅/❌] — [reason]
- Transoesophageal Echo: [✅/❌] — [reason]
- Cardiac output monitoring: [✅/❌] — [reason]
- Cerebral oximetry: [✅/❌] — [reason]
- Urinary catheter: [✅/❌] — [reason]

## 💉 Stage 5: Induction & Maintenance
**Induction:** [agents + doses]
**Maintenance:** [TIVA vs volatile — justify]
**Neuromuscular blockade:** [agent, rationale, reversal]
**Haemodynamic goals:** MAP [target], HR [target], vasopressor choice

## 🧠 Stage 6: Regional Anaesthesia Module
**Applicable techniques:** [list ALL relevant]
**Recommended:** [specific technique] — [evidence and rationale]
**Timing:** [pre/post-induction/postop]
**Contraindications:** [coagulation, anatomy, patient refusal]

## 💧 Stage 7: Fluid Management Strategy
**Expected blood loss:** [mL estimate]
**Fluid strategy:** [GDT/Restrictive/Liberal — justify]
**Baseline fluid:** [type and rate]
**Fluid bolus trigger:** [MAP/SVV/lactate threshold]
**Fluid bolus:** [250–500mL crystalloid vs colloid]
**Transfusion trigger:** [Hb threshold with justification]
**Blood products:** [FFP/platelets/cryo if relevant]
**Cell salvage:** [✅/❌]
**Target urine output:** [mL/kg/hr]
**Special considerations:** [renal protection, cardiac optimisation]

## 🩹 Stage 8: Postoperative Analgesia
**Expected pain severity:** [Mild/Moderate/Severe]
**Multimodal plan:**
- Paracetamol: [dose/route]
- NSAID: [dose or contraindicated because...]
- Regional/neuraxial continuation: [plan]
- Opioid: [PCA/SC/oral — agent and dose]
- Adjuncts: [ketamine/dexmedetomidine/gabapentin if indicated]
**PONV risk:** [Apfel score] → [prophylaxis level and agents]

## 🏥 Stage 9: Postoperative Destination
**Recommended:** [Ward/HDU/ICU]
**Justification:** [specific reasons]
**ICU escalation triggers:** [conditions]
**Expected length of stay:** [estimate]

## ⚠️ Stage 10: Safety Audit
- Aspiration risk addressed: [✅/❌]
- Difficult airway plan: [✅/❌]
- Regional technique considered: [✅/❌]
- ERAS compliance: [✅/❌/N/A]
- VTE prophylaxis: [✅/❌]
- Blood loss/transfusion strategy: [✅/❌]
- Fluid management individualised: [✅/❌]
- Drug allergies checked: [✅/❌]
- ASA-PS verified: [✅/❌]
- Comorbidity drug interactions: [list]

## 🔄 Stage 11: Alternative Plan & Expert Debate
**Alternative plan:** [description]
**Genuine areas of disagreement:** [2-3 points]
**Critical red flags:** [safety concerns]

## 📝 Stage 12: Case Summary Card
**One-line summary:** [e.g. "ASA 3E, 65M, open gastrectomy — GA+TEA, RSI, A-line, GDT, HDU"]
**ASA-PS (AI):** [grade] | **Cardiac Risk:** [RCRI] | **Pulmonary Risk:** [ARISCAT]
**Key anaesthetic concerns:** [top 3]

Be precise, specific, safety-first.`;
}

// ─── CONSULTANT REVIEW PROMPT ─────────────────────────────────────────────────
function buildConsultantPrompt(entry, reviewNote) {
  return `You are a senior consultant anaesthesiologist peer-reviewing a colleague's anaesthetic plan. Be critical, constructive, and thorough.

Original case:
${entry.caseText}

AI-generated plan:
${entry.result}

Reviewer's notes/concerns:
${reviewNote || "General peer review requested"}

Provide your consultant review covering:
## 🔍 Overall Assessment
[Agree/Partially agree/Disagree with plan — overall verdict]

## ✅ What the plan gets right
[Bullet list of correct decisions]

## ⚠️ Points of Concern
[Specific concerns with reasoning — be direct]

## 🔄 What I would do differently
[Specific alternative decisions with evidence-based justification]

## 🚨 Safety Issues
[Any patient safety concerns — flag clearly]

## 📚 Evidence Base
[Key guidelines or trials relevant to this case]

## 📝 Consultant Summary
[2-3 sentence overall verdict]`;
}

// ─── MARKDOWN RENDERER ────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return <div key={i} style={{ marginTop:"1.3rem", marginBottom:"0.3rem", fontSize:"0.93rem", fontWeight:700, color:"#1a3a5c", borderBottom:"2px solid #e2ecf7", paddingBottom:"0.3rem" }}>{line.replace("## ","")}</div>;
    }
    if (line.startsWith("**") && line.includes(":**")) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      return <p key={i} style={{ margin:"0.2rem 0", fontSize:"0.84rem", color:"#2d3748", lineHeight:1.6 }}>
        {parts.map((p,j) => j%2===1
          ? <strong key={j} style={{ color:"#1a3a5c" }}>{p}</strong>
          : <span key={j} dangerouslySetInnerHTML={{ __html: p.replace(/✅/g,'<span style="color:#22863a">✅</span>').replace(/❌/g,'<span style="color:#cb2431">❌</span>') }} />
        )}
      </p>;
    }
    if (line.startsWith("- ")) {
      return <li key={i} style={{ fontSize:"0.84rem", color:"#2d3748", marginLeft:"1.2rem", marginBottom:"0.1rem", lineHeight:1.6 }} dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/✅/g,'<span style="color:#22863a">✅</span>').replace(/❌/g,'<span style="color:#cb2431">❌</span>') }} />;
    }
    if (line.trim()) {
      return <p key={i} style={{ margin:"0.15rem 0", fontSize:"0.84rem", color:"#2d3748", lineHeight:1.6 }} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/✅/g,'<span style="color:#22863a">✅</span>').replace(/❌/g,'<span style="color:#cb2431">❌</span>') }} />;
    }
    return null;
  });
}

// ─── SMALL UI COMPONENTS ──────────────────────────────────────────────────────
function Badge({ label, value, color }) {
  return <div style={{ display:"inline-flex", flexDirection:"column", alignItems:"center", background:color+"18", border:`1.5px solid ${color}40`, borderRadius:8, padding:"0.3rem 0.65rem", marginRight:"0.35rem", marginBottom:"0.35rem" }}>
    <span style={{ fontSize:"0.58rem", color, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase" }}>{label}</span>
    <span style={{ fontSize:"0.78rem", fontWeight:700, color:"#1a3a5c" }}>{value}</span>
  </div>;
}

function Btn({ onClick, disabled, children, style={} }) {
  return <button onClick={onClick} disabled={disabled} style={{ border:"none", borderRadius:8, padding:"0.6rem 1.2rem", fontWeight:700, fontSize:"0.85rem", cursor:disabled?"not-allowed":"pointer", fontFamily:"inherit", transition:"opacity 0.15s", opacity:disabled?0.6:1, ...style }}>{children}</button>;
}

function Check({ label, checked, onChange }) {
  return <label style={{ display:"flex", alignItems:"center", gap:"0.4rem", fontSize:"0.78rem", color:"#4a5568", cursor:"pointer", marginBottom:"0.22rem" }}>
    <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ accentColor:"#2b7de9", width:13, height:13 }} />
    {label}
  </label>;
}

function Sel({ value, onChange, options }) {
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{ width:"100%", padding:"0.45rem 0.6rem", borderRadius:6, border:"1.5px solid #e2e8f0", fontSize:"0.81rem", color:"#2d3748", outline:"none", background:"white", fontFamily:"inherit" }}>
    {options.map(o => <option key={Array.isArray(o)?o[0]:o} value={Array.isArray(o)?o[0]:o}>{Array.isArray(o)?o[1]:o}</option>)}
  </select>;
}

function Inp({ value, onChange, placeholder="", type="text", step }) {
  return <input type={type} value={value} step={step} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ width:"100%", padding:"0.45rem 0.6rem", borderRadius:6, border:"1.5px solid #e2e8f0", fontSize:"0.81rem", color:"#2d3748", outline:"none", fontFamily:"inherit", boxSizing:"border-box" }} />;
}

function TabBtn({ label, active, onClick, count }) {
  return <button onClick={onClick} style={{ padding:"0.55rem 0.9rem", border:"none", background:"none", cursor:"pointer", fontSize:"0.8rem", fontWeight:active?700:400, color:active?"#1a3a5c":"#718096", borderBottom:active?"2.5px solid #2b7de9":"2.5px solid transparent", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:"0.3rem", fontFamily:"inherit" }}>
    {label}
    {count!=null && <span style={{ background:active?"#2b7de9":"#e2e8f0", color:active?"white":"#718096", borderRadius:10, padding:"0.08rem 0.4rem", fontSize:"0.68rem", fontWeight:700 }}>{count}</span>}
  </button>;
}

function SH({ children }) {
  return <div style={{ fontSize:"0.75rem", fontWeight:700, color:"#1a3a5c", marginBottom:"0.5rem", paddingBottom:"0.25rem", borderBottom:"1.5px solid #e2ecf7" }}>{children}</div>;
}

const lS = { fontSize:"0.7rem", fontWeight:600, color:"#4a5568", display:"block", marginBottom:"0.15rem", textTransform:"uppercase", letterSpacing:"0.03em" };
function F({ label, children }) { return <div><label style={lS}>{label}</label>{children}</div>; }
function G({ cols=2, children }) { return <div style={{ display:"grid", gridTemplateColumns:`repeat(${cols},1fr)`, gap:"0.4rem" }}>{children}</div>; }

function riskColor(risk="") {
  const r = risk.toLowerCase();
  if (r.includes("very low")||r.startsWith("low")) return "#22863a";
  if (r.includes("intermediate")) return "#d97706";
  return "#c53030";
}
function riskBg(risk="") {
  const r = risk.toLowerCase();
  if (r.includes("very low")||r.startsWith("low")) return "#f0fff4";
  if (r.includes("intermediate")) return "#fffbeb";
  return "#fff5f5";
}

// ─── ASA SELECTOR ─────────────────────────────────────────────────────────────
function ASASelector({ value, onChange, isEmergency }) {
  const desc = { "1":"Healthy, no systemic disease","2":"Mild systemic disease, no functional limitation","3":"Severe systemic disease, functional limitation","4":"Severe systemic disease, constant threat to life","5":"Moribund, not expected to survive without surgery" };
  return <div>
    <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem", marginBottom:"0.4rem" }}>
      {["1","2","3","4","5"].map(g =>
        <button key={g} onClick={()=>onChange(g)} style={{ padding:"0.35rem 0.65rem", borderRadius:6, border:`1.5px solid ${value===g?"#2b7de9":"#e2e8f0"}`, background:value===g?"#ebf4ff":"white", color:value===g?"#1a3a5c":"#718096", fontWeight:value===g?700:400, fontSize:"0.82rem", cursor:"pointer", fontFamily:"inherit" }}>
          {g}{isEmergency?"E":""}
        </button>
      )}
    </div>
    {value && <div style={{ fontSize:"0.72rem", color:"#4a5568", background:"#f7faff", padding:"0.3rem 0.5rem", borderRadius:5, lineHeight:1.4 }}>{desc[value]}{isEmergency?" · Emergency (E suffix applied)":""}</div>}
  </div>;
}

// ─── RISK SCORE FORMS ─────────────────────────────────────────────────────────
function RCRIForm({ vals, setVals }) {
  const tog = k => setVals(p=>({...p,[k]:!p[k]}));
  return <div>
    <Check label="High-risk surgery (intraperitoneal, intrathoracic, suprainguinal vascular)" checked={vals.highRiskSurgery||false} onChange={()=>tog("highRiskSurgery")} />
    <Check label="Ischaemic heart disease (hx MI, positive stress test, current angina, nitrates, Q waves)" checked={vals.ischemicHeartDisease||false} onChange={()=>tog("ischemicHeartDisease")} />
    <Check label="Congestive heart failure (hx HF, pulmonary oedema, PND, bilateral rales, S3, CXR redistribution)" checked={vals.heartFailure||false} onChange={()=>tog("heartFailure")} />
    <Check label="Cerebrovascular disease (history of stroke or TIA)" checked={vals.cerebrovascularDisease||false} onChange={()=>tog("cerebrovascularDisease")} />
    <Check label="Insulin-dependent diabetes mellitus" checked={vals.insulinDependentDiabetes||false} onChange={()=>tog("insulinDependentDiabetes")} />
    <Check label="Creatinine >2.0 mg/dL (177 µmol/L)" checked={vals.creatinineAbove2||false} onChange={()=>tog("creatinineAbove2")} />
  </div>;
}

function ARISCATForm({ vals, setVals }) {
  const tog = k => setVals(p=>({...p,[k]:!p[k]}));
  return <div>
    <div style={{ fontSize:"0.7rem", color:"#718096", marginBottom:"0.4rem" }}>Tick all that apply:</div>
    <Check label="SpO₂ 95–98% on room air (+8 pts)" checked={vals.spo2_95_98||false} onChange={()=>tog("spo2_95_98")} />
    <Check label="SpO₂ <95% on room air (+24 pts)" checked={vals.spo2_lt95||false} onChange={()=>tog("spo2_lt95")} />
    <Check label="Respiratory infection in last month (+17 pts)" checked={vals.respiratoryInfectionLastMonth||false} onChange={()=>tog("respiratoryInfectionLastMonth")} />
    <Check label="Anaemia (Hb ≤10 g/dL) (+11 pts)" checked={vals.anemia||false} onChange={()=>tog("anemia")} />
    <Check label="Upper abdominal or thoracic surgery (+15 pts)" checked={vals.upperAbdominalOrThoracic||false} onChange={()=>tog("upperAbdominalOrThoracic")} />
    <Check label="Surgery >2 hrs (+16 pts)" checked={vals.surgeryOver2hrs||false} onChange={()=>tog("surgeryOver2hrs")} />
    <Check label="Emergency surgery (+8 pts)" checked={vals.emergencySurgery||false} onChange={()=>tog("emergencySurgery")} />
  </div>;
}

function STOPBANGForm({ vals, setVals }) {
  const tog = k => setVals(p=>({...p,[k]:!p[k]}));
  return <div>
    <Check label="S — Snoring loudly" checked={vals.snoring||false} onChange={()=>tog("snoring")} />
    <Check label="T — Tired/fatigued >3×/week" checked={vals.tired||false} onChange={()=>tog("tired")} />
    <Check label="O — Observed stopping breathing during sleep" checked={vals.observed||false} onChange={()=>tog("observed")} />
    <Check label="P — Pressure (treated/untreated hypertension)" checked={vals.pressure||false} onChange={()=>tog("pressure")} />
    <Check label="B — BMI >35" checked={vals.bmi35||false} onChange={()=>tog("bmi35")} />
    <Check label="A — Age >50" checked={vals.ageOver50||false} onChange={()=>tog("ageOver50")} />
    <Check label="N — Neck circumference >40 cm" checked={vals.neckOver40||false} onChange={()=>tog("neckOver40")} />
    <Check label="G — Gender male" checked={vals.male||false} onChange={()=>tog("male")} />
  </div>;
}

function ScoreBox({ label, score, risk, pct }) {
  const c = riskColor(risk); const bg = riskBg(risk);
  return <div style={{ background:bg, border:`1.5px solid ${c}30`, borderRadius:8, padding:"0.5rem 0.7rem" }}>
    <div style={{ fontSize:"0.65rem", fontWeight:700, color:"#718096", textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
    <div style={{ fontSize:"1rem", fontWeight:700, color:c, lineHeight:1.2 }}>{score??"-"}{pct?<span style={{ fontSize:"0.7rem", color:"#718096", marginLeft:4 }}>({pct})</span>:null}</div>
    <div style={{ fontSize:"0.72rem", color:c }}>{risk}</div>
  </div>;
}

// ─── STRUCTURED FORM ─────────────────────────────────────────────────────────
function StructuredForm({ onSubmit, loading }) {
  const [f, setF] = useState({
    age:"", sex:"Male", weight:"", height:"",
    surgery:"", urgency:"Elective", duration:"",
    expectedBloodLoss:"Minimal (<250 mL)", surgicalCategory:"GI / Upper Abdominal",
    htn:false, ihd:false, hf:false, cvd:false, dm_insulin:false, copd:false, osa:false, ckd:false, obesity:false,
    asaGrade:"",
    hb:"", creatinine_mgdl:"", platelets:"", sodium:"", potassium:"", inr:"",
    echo:"", ecg:"", spirometry:"",
    fasting:"", medications:"",
    mallampati:"I", mouthOpening:"Normal (>3 cm)", neckMovement:"Normal",
    previousDifficultAirway:false,
    gerd:false, pregnancy:false, bowelObstruction:false, diabeticGastroparesis:false,
    allergies:"", previousAnaesthetic:"Uneventful", functionalCapacity:"", notes:""
  });
  const [rcri, setRcri] = useState({});
  const [ariscat, setAriscat] = useState({});
  const [stopbang, setStopbang] = useState({});
  const [scoreTab, setScoreTab] = useState("rcri");

  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const tog = k => setF(p=>({...p,[k]:!p[k]}));
  const isEmergency = f.urgency==="Emergency";
  const rcriR = calcRCRI(rcri); const ariscatR = calcARISCAT(ariscat); const sbR = calcSTOPBANG(stopbang);

  const bmi = f.weight && f.height ? (parseFloat(f.weight)/Math.pow(parseFloat(f.height)/100,2)).toFixed(1) : null;

  function buildCase() {
    return `Patient: ${f.age||"?"}yo ${f.sex}, ${f.weight||"?"}kg${f.height?", "+f.height+"cm":""}${bmi?", BMI "+bmi:""}
Surgery: ${f.surgery||"?"} (${f.urgency}${f.duration?", est. "+f.duration:""})
Surgical category: ${f.surgicalCategory} | Expected blood loss: ${f.expectedBloodLoss}
User ASA-PS: ${f.asaGrade?`ASA ${f.asaGrade}${isEmergency?"E":""}`: "Not specified"}
Comorbidities: ${[f.htn&&"Hypertension",f.ihd&&"IHD/CAD",f.hf&&"Heart Failure",f.cvd&&"CVD",f.dm_insulin&&"Insulin-dependent DM",f.copd&&"COPD",f.osa&&"OSA",f.ckd&&"CKD",f.obesity&&"Obesity BMI>35"].filter(Boolean).join(", ")||"None"}
Functional capacity: ${f.functionalCapacity||"Not specified"}
Investigations: Hb ${f.hb||"NR"} g/dL, Creatinine ${f.creatinine_mgdl||"NR"} mg/dL, Platelets ${f.platelets||"NR"}, Na ${f.sodium||"NR"}, K ${f.potassium||"NR"}, INR ${f.inr||"NR"}
ECG: ${f.ecg||"Not reported"} | Echo: ${f.echo||"Not reported"} | Spirometry: ${f.spirometry||"Not reported"}
Medications: ${f.medications||"Not specified"} | Fasting: ${f.fasting||"Not specified"}
Airway: Mallampati ${f.mallampati}, Mouth opening ${f.mouthOpening}, Neck ${f.neckMovement}${f.previousDifficultAirway?", Previous difficult airway":""}
Aspiration risks: ${[f.gerd&&"GERD",f.pregnancy&&"Pregnancy",f.bowelObstruction&&"Bowel obstruction",f.diabeticGastroparesis&&"Diabetic gastroparesis"].filter(Boolean).join(", ")||"None"}
Allergies: ${f.allergies||"NKDA"} | Previous anaesthetic: ${f.previousAnaesthetic}
Notes: ${f.notes||"None"}`;
  }
  function buildScores() {
    return `RCRI: ${rcriR.score}/6 → ${rcriR.risk} (MACE risk ${rcriR.pct})\nARISCAT: ${ariscatR.score} → ${ariscatR.risk}\nSTOP-BANG: ${sbR.score}/8 → ${sbR.risk}`;
  }

  const handleSubmit = () => {
    if (!f.surgery) { alert("Please enter the planned surgery."); return; }
    if (!f.age) { alert("Please enter patient age."); return; }
    onSubmit({ caseText:buildCase(), scoresText:buildScores(), formData:f, rcri:rcriR, ariscat:ariscatR, stopbang:sbR });
  };

  return <div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:"0.8rem", marginBottom:"0.8rem" }}>
      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>👤 Demographics</SH>
        <G><F label="Age (yrs)"><Inp type="number" value={f.age} onChange={v=>set("age",v)} /></F>
        <F label="Sex"><Sel value={f.sex} onChange={v=>set("sex",v)} options={["Male","Female","Other"]} /></F>
        <F label="Weight (kg)"><Inp type="number" value={f.weight} onChange={v=>set("weight",v)} /></F>
        <F label="Height (cm)"><Inp type="number" value={f.height} onChange={v=>set("height",v)} /></F></G>
        {bmi && <div style={{ fontSize:"0.72rem", color:"#4a5568", background:"#f7faff", padding:"0.3rem 0.5rem", borderRadius:5, marginTop:"0.4rem" }}>BMI: {bmi} kg/m²</div>}
        <div style={{ marginTop:"0.5rem" }}><F label="Functional Capacity"><Sel value={f.functionalCapacity} onChange={v=>set("functionalCapacity",v)} options={[["","Unknown"],["<4 METs (Poor)","<4 METs (Poor)"],["4–7 METs (Moderate)","4–7 METs (Moderate)"],[">7 METs (Good)",">7 METs (Good)"]]} /></F></div>
      </div>

      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>🔪 Surgery</SH>
        <F label="Planned Procedure"><Inp value={f.surgery} onChange={v=>set("surgery",v)} placeholder="e.g. Open gastrectomy" /></F>
        <div style={{ marginTop:"0.4rem" }} />
        <G><F label="Urgency"><Sel value={f.urgency} onChange={v=>set("urgency",v)} options={["Elective","Urgent","Emergency"]} /></F>
        <F label="Est. Duration"><Inp value={f.duration} onChange={v=>set("duration",v)} placeholder="e.g. 3 hrs" /></F></G>
        <div style={{ marginTop:"0.4rem" }}>
          <F label="Surgical Category"><Sel value={f.surgicalCategory} onChange={v=>set("surgicalCategory",v)} options={["GI / Upper Abdominal","GI / Lower Abdominal / Colorectal","Thoracic","Cardiac","Orthopaedic","Obstetric / Gynaecology","Neuro / Spine","Vascular","Paediatric","ENT / Maxillofacial","Urological","Other"]} /></F>
          <div style={{ marginTop:"0.4rem" }} />
          <F label="Expected Blood Loss"><Sel value={f.expectedBloodLoss} onChange={v=>set("expectedBloodLoss",v)} options={["Minimal (<250 mL)","Moderate (250–1000 mL)","Major (1–3 L)","Massive (>3 L)"]} /></F>
        </div>
      </div>

      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>🏷️ ASA Physical Status</SH>
        <p style={{ fontSize:"0.73rem", color:"#718096", margin:"0 0 0.5rem", lineHeight:1.5 }}>Select your grade. AI will independently assess and flag discrepancies.</p>
        <ASASelector value={f.asaGrade} onChange={v=>set("asaGrade",v)} isEmergency={isEmergency} />
      </div>

      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>🏥 Comorbidities</SH>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr" }}>
          {[["htn","Hypertension"],["ihd","IHD/CAD"],["hf","Heart Failure"],["cvd","CVD/TIA"],["dm_insulin","DM (Insulin)"],["copd","COPD"],["osa","OSA"],["ckd","CKD"],["obesity","Obesity >35"]].map(([k,l]) => <Check key={k} label={l} checked={f[k]} onChange={()=>tog(k)} />)}
        </div>
      </div>
    </div>

    <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7", marginBottom:"0.8rem" }}>
      <SH>🧪 Investigations</SH>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:"0.4rem", marginBottom:"0.5rem" }}>
        {[["hb","Hb (g/dL)"],["creatinine_mgdl","Creatinine (mg/dL)"],["platelets","Platelets (×10⁹)"],["sodium","Sodium (mEq/L)"],["potassium","Potassium (mEq/L)"],["inr","INR"]].map(([k,l]) => <F key={k} label={l}><Inp type="number" step="0.01" value={f[k]} onChange={v=>set(k,v)} /></F>)}
      </div>
      <G cols={3}>
        <F label="ECG"><Inp value={f.ecg} onChange={v=>set("ecg",v)} placeholder="e.g. Sinus rhythm, Q waves II/III" /></F>
        <F label="Echo / TTE"><Inp value={f.echo} onChange={v=>set("echo",v)} placeholder="e.g. EF 45%, mild MR" /></F>
        <F label="Spirometry / PFTs"><Inp value={f.spirometry} onChange={v=>set("spirometry",v)} placeholder="e.g. FEV1 65%, moderate obstruction" /></F>
      </G>
    </div>

    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:"0.8rem", marginBottom:"0.8rem" }}>
      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>😮 Airway Assessment</SH>
        <G><F label="Mallampati Class"><Sel value={f.mallampati} onChange={v=>set("mallampati",v)} options={["I","II","III","IV"]} /></F>
        <F label="Mouth Opening"><Sel value={f.mouthOpening} onChange={v=>set("mouthOpening",v)} options={["Normal (>3 cm)","Reduced (2–3 cm)","Limited (<2 cm)"]} /></F>
        <F label="Neck Movement"><Sel value={f.neckMovement} onChange={v=>set("neckMovement",v)} options={["Normal","Reduced","Fixed/Rigid"]} /></F>
        <F label="Previous Anaesthetic"><Sel value={f.previousAnaesthetic} onChange={v=>set("previousAnaesthetic",v)} options={["Uneventful","Difficult intubation","Failed intubation","Awareness","Other"]} /></F></G>
        <div style={{ marginTop:"0.5rem" }}><Check label="Previous difficult airway documented" checked={f.previousDifficultAirway} onChange={v=>set("previousDifficultAirway",v)} /></div>
      </div>

      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>⚠️ Aspiration Risk Factors</SH>
        <Check label="GERD / Symptomatic reflux" checked={f.gerd} onChange={v=>set("gerd",v)} />
        <Check label="Pregnancy" checked={f.pregnancy} onChange={v=>set("pregnancy",v)} />
        <Check label="Bowel obstruction / ileus" checked={f.bowelObstruction} onChange={v=>set("bowelObstruction",v)} />
        <Check label="Diabetic gastroparesis" checked={f.diabeticGastroparesis} onChange={v=>set("diabeticGastroparesis",v)} />
        <div style={{ marginTop:"0.7rem" }}><F label="Fasting Status"><Inp value={f.fasting} onChange={v=>set("fasting",v)} placeholder="e.g. NBM 8h solids, 2h fluids" /></F></div>
      </div>

      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>💊 Medications &amp; Allergies</SH>
        <F label="Current Medications"><Inp value={f.medications} onChange={v=>set("medications",v)} placeholder="e.g. Warfarin, ramipril, insulin" /></F>
        <div style={{ marginTop:"0.4rem" }} />
        <F label="Drug Allergies / Reactions"><Inp value={f.allergies} onChange={v=>set("allergies",v)} placeholder="e.g. Penicillin → anaphylaxis, latex" /></F>
        <div style={{ marginTop:"0.7rem" }}>
          <SH>📝 Additional Notes</SH>
          <textarea value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="Prior operations, implants, pacemaker, significant history…" style={{ width:"100%", minHeight:72, padding:"0.45rem 0.6rem", borderRadius:6, border:"1.5px solid #e2e8f0", fontSize:"0.81rem", color:"#2d3748", outline:"none", fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
        </div>
      </div>
    </div>

    {/* Risk Score Calculators */}
    <div style={{ background:"white", borderRadius:10, border:"1px solid #e2ecf7", marginBottom:"0.8rem", overflow:"hidden" }}>
      <div style={{ background:"#f7faff", borderBottom:"1px solid #e2ecf7", padding:"0.5rem 0.9rem" }}>
        <div style={{ fontSize:"0.75rem", fontWeight:700, color:"#1a3a5c" }}>📐 Pre-Operative Risk Scores</div>
        <div style={{ fontSize:"0.68rem", color:"#718096" }}>All three scores are fed directly into the AI system prompt</div>
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid #e2ecf7", overflowX:"auto" }}>
        {[["rcri","RCRI (Cardiac)"],["ariscat","ARISCAT (Pulmonary)"],["stopbang","STOP-BANG (OSA)"]].map(([k,l]) => <TabBtn key={k} label={l} active={scoreTab===k} onClick={()=>setScoreTab(k)} />)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"1rem", padding:"0.9rem", alignItems:"start" }}>
        <div>
          {scoreTab==="rcri" && <RCRIForm vals={rcri} setVals={setRcri} />}
          {scoreTab==="ariscat" && <ARISCATForm vals={ariscat} setVals={setAriscat} />}
          {scoreTab==="stopbang" && <STOPBANGForm vals={stopbang} setVals={setStopbang} />}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.5rem", minWidth:170 }}>
          <ScoreBox label="RCRI" score={rcriR.score} risk={rcriR.risk} pct={rcriR.pct} />
          <ScoreBox label="ARISCAT" score={ariscatR.score} risk={ariscatR.risk} />
          <ScoreBox label="STOP-BANG" score={sbR.score} risk={sbR.risk} />
        </div>
      </div>
    </div>

    <Btn onClick={handleSubmit} disabled={loading} style={{ width:"100%", background:loading?"#a0aec0":"#2b7de9", color:"white", padding:"0.75rem", fontSize:"0.9rem" }}>
      {loading ? "⏳ Generating AI Assessment…" : "⚕️ Generate Full Anaesthetic Plan (12 Stages)"}
    </Btn>
  </div>;
}

// ─── RESULT DISPLAY ───────────────────────────────────────────────────────────
function ResultDisplay({ result, meta, onSave, saving, saved, streaming, truncated, onContinue }) {
  const { rcri, ariscat, stopbang } = meta;
  return <div>
    {/* Sticky save bar — always visible */}
    <div style={{ position:"sticky", top:0, zIndex:10, background:"white", border:"1px solid #e2ecf7", borderRadius:10, padding:"0.6rem 0.9rem", marginBottom:"0.7rem", display:"flex", flexWrap:"wrap", alignItems:"center", gap:"0.4rem", boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>
      <Badge label="RCRI" value={`${rcri.score}/6 · ${rcri.risk}`} color={riskColor(rcri.risk)} />
      <Badge label="ARISCAT" value={`${ariscat.score} · ${ariscat.risk}`} color={riskColor(ariscat.risk)} />
      <Badge label="STOP-BANG" value={`${stopbang.score}/8 · ${stopbang.risk}`} color={riskColor(stopbang.risk)} />
      <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"0.5rem", flexWrap:"wrap" }}>
        {streaming && <span style={{ fontSize:"0.72rem", color:"#2b7de9", fontWeight:600 }}>⏳ Streaming…</span>}
        {truncated && !streaming && (
          <Btn onClick={onContinue} style={{ background:"#7c3aed", color:"white", fontSize:"0.8rem", padding:"0.45rem 1rem" }}>
            ▶ Continue Assessment
          </Btn>
        )}
        <Btn onClick={onSave} disabled={saving||saved||streaming} style={{ background:saved?"#22863a":saving?"#a0aec0":streaming?"#a0aec0":"#2b7de9", color:"white", fontSize:"0.8rem", padding:"0.45rem 1rem" }}>
          {saved?"✅ Saved":saving?"Saving…":streaming?"Wait…":"💾 Save to Shared History"}
        </Btn>
      </div>
    </div>
    {truncated && !streaming && (
      <div style={{ background:"#fffbeb", border:"1.5px solid #f59e0b", borderRadius:8, padding:"0.6rem 0.9rem", marginBottom:"0.7rem", fontSize:"0.78rem", color:"#92400e", display:"flex", alignItems:"center", gap:"0.6rem" }}>
        <span>⚠️</span>
        <span><strong>Assessment was cut off</strong> — the response hit the token limit mid-way. Click <strong>▶ Continue Assessment</strong> above to resume from where it stopped.</span>
      </div>
    )}
    <div style={{ background:"white", borderRadius:10, padding:"1rem 1.1rem", border:"1px solid #e2ecf7", lineHeight:1.6 }}>
      {renderMarkdown(result)}
      {streaming && <span style={{ display:"inline-block", width:8, height:16, background:"#2b7de9", borderRadius:2, marginLeft:2, animation:"blink 0.8s infinite" }} />}
    </div>
    <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
  </div>;
}

// ─── CASE DASHBOARD ───────────────────────────────────────────────────────────
function CaseDashboard({ entries }) {
  if (entries.length === 0) return (
    <div style={{ textAlign:"center", padding:"3rem 1rem", color:"#718096" }}>
      <div style={{ fontSize:"2.5rem", marginBottom:"0.5rem" }}>📊</div>
      <div style={{ fontWeight:600 }}>No cases saved yet</div>
      <div style={{ fontSize:"0.8rem", marginTop:"0.3rem" }}>Save assessments to see analytics here.</div>
    </div>
  );

  const total = entries.length;
  const urgency = { Elective:0, Urgent:0, Emergency:0 };
  const asaCounts = {};
  const rcriCounts = { "Very Low":0, Low:0, Intermediate:0, High:0 };
  const catCounts = {};
  const recentDays = 7;
  const cutoff = new Date(Date.now() - recentDays*86400000);
  let recentCount = 0;

  entries.forEach(e => {
    const fd = e.formData || {};
    if (fd.urgency && urgency[fd.urgency] !== undefined) urgency[fd.urgency]++;
    if (fd.asaGrade) asaCounts[fd.asaGrade] = (asaCounts[fd.asaGrade]||0)+1;
    if (e.rcri?.risk) rcriCounts[e.rcri.risk] = (rcriCounts[e.rcri.risk]||0)+1;
    if (fd.surgicalCategory) catCounts[fd.surgicalCategory] = (catCounts[fd.surgicalCategory]||0)+1;
    if (e.savedAt && new Date(e.savedAt) > cutoff) recentCount++;
  });

  const topCat = Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const StatCard = ({ title, value, sub, color="#2b7de9" }) => (
    <div style={{ background:"white", borderRadius:10, padding:"1rem", border:"1px solid #e2ecf7", textAlign:"center" }}>
      <div style={{ fontSize:"2rem", fontWeight:800, color }}>{value}</div>
      <div style={{ fontSize:"0.8rem", fontWeight:700, color:"#1a3a5c" }}>{title}</div>
      {sub && <div style={{ fontSize:"0.7rem", color:"#718096", marginTop:"0.2rem" }}>{sub}</div>}
    </div>
  );

  const BarRow = ({ label, count, max, color }) => (
    <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.4rem" }}>
      <div style={{ fontSize:"0.75rem", color:"#4a5568", width:160, flexShrink:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{label}</div>
      <div style={{ flex:1, background:"#f0f4f8", borderRadius:4, height:16, overflow:"hidden" }}>
        <div style={{ width:`${(count/max)*100}%`, background:color||"#2b7de9", height:"100%", borderRadius:4, transition:"width 0.4s" }} />
      </div>
      <div style={{ fontSize:"0.75rem", fontWeight:700, color:"#1a3a5c", width:24, textAlign:"right" }}>{count}</div>
    </div>
  );

  return <div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:"0.7rem", marginBottom:"1rem" }}>
      <StatCard title="Total Cases" value={total} sub="All time" />
      <StatCard title="Last 7 Days" value={recentCount} sub="Recent activity" color="#7c3aed" />
      <StatCard title="Emergency" value={urgency.Emergency} sub={`${total?Math.round(urgency.Emergency/total*100):0}% of cases`} color="#c53030" />
      <StatCard title="Urgent" value={urgency.Urgent} sub={`${total?Math.round(urgency.Urgent/total*100):0}% of cases`} color="#d97706" />
      <StatCard title="Elective" value={urgency.Elective} sub={`${total?Math.round(urgency.Elective/total*100):0}% of cases`} color="#22863a" />
    </div>

    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.8rem", marginBottom:"0.8rem" }}>
      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>ASA Distribution</SH>
        {Object.entries(asaCounts).sort().map(([k,v]) => <BarRow key={k} label={`ASA ${k}`} count={v} max={Math.max(...Object.values(asaCounts))} color="#2b7de9" />)}
        {Object.keys(asaCounts).length===0 && <div style={{ fontSize:"0.78rem", color:"#718096" }}>No ASA data recorded</div>}
      </div>
      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>RCRI Cardiac Risk</SH>
        {Object.entries(rcriCounts).filter(([,v])=>v>0).map(([k,v]) => <BarRow key={k} label={k} count={v} max={Math.max(...Object.values(rcriCounts).filter(Boolean),1)} color={riskColor(k)} />)}
        {Object.values(rcriCounts).every(v=>v===0) && <div style={{ fontSize:"0.78rem", color:"#718096" }}>No RCRI data recorded</div>}
      </div>
    </div>

    <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
      <SH>Top Surgical Categories</SH>
      {topCat.map(([k,v]) => <BarRow key={k} label={k} count={v} max={topCat[0][1]} color="#7c3aed" />)}
      {topCat.length===0 && <div style={{ fontSize:"0.78rem", color:"#718096" }}>No data yet</div>}
    </div>

    <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7", marginTop:"0.8rem" }}>
      <SH>Recent Cases (last {recentDays} days)</SH>
      {entries.filter(e=>e.savedAt && new Date(e.savedAt)>cutoff).sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt)).map(e => (
        <div key={e.id} style={{ display:"flex", alignItems:"center", gap:"0.6rem", padding:"0.45rem 0", borderBottom:"1px solid #f0f4f8" }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:riskColor(e.rcri?.risk||""), flexShrink:0 }} />
          <div style={{ flex:1, fontSize:"0.8rem", color:"#2d3748" }}>{e.formData?.age}yo {e.formData?.sex} · {e.formData?.surgery||"Unknown"}</div>
          <div style={{ fontSize:"0.7rem", color:"#718096" }}>{new Date(e.savedAt).toLocaleDateString()}</div>
        </div>
      ))}
      {recentCount===0 && <div style={{ fontSize:"0.78rem", color:"#718096" }}>No cases in the last {recentDays} days</div>}
    </div>

    <AIQualityPanel entries={entries} />
  </div>;
}

// ─── AI ASSESSMENT QUALITY PANEL ──────────────────────────────────────────────
// Aggregates consultant-scored entries: overall verdict distribution + per-domain
// cumulative % (to flag which of the 10 domains the AI is weakest in).
function AIQualityPanel({ entries }) {
  const scored = entries.filter(e => e.consultantScoring && e.consultantScoring.pct !== undefined);
  const totalScored = scored.length;

  if (totalScored === 0) {
    return (
      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7", marginTop:"0.8rem" }}>
        <SH>🔍 AI Assessment Quality (Consultant-Scored)</SH>
        <div style={{ fontSize:"0.78rem", color:"#718096" }}>No consultant-scored assessments yet. Score cases in the Consultant Review tab to populate this panel.</div>
      </div>
    );
  }

  const appropriate = scored.filter(e => e.consultantScoring.pct >= 90).length;
  const partial = scored.filter(e => e.consultantScoring.pct >= 70 && e.consultantScoring.pct < 90).length;
  const notAppropriate = scored.filter(e => e.consultantScoring.pct < 70).length;
  const pctOf = n => totalScored ? Math.round((n/totalScored)*100) : 0;

  // Cumulative per-domain %: sum of all scores given for that domain across every
  // scored entry, divided by max possible (2 points per entry) → percentage.
  const domainStats = REVIEW_DOMAINS.map(d => {
    let sum = 0, count = 0;
    scored.forEach(e => {
      const v = e.consultantScoring.scores?.[d.key];
      if (v !== undefined) { sum += v; count++; }
    });
    const pct = count ? Math.round((sum / (count*2)) * 100) : null;
    return { ...d, pct, count };
  }).sort((a,b) => (a.pct??101) - (b.pct??101)); // weakest domains first

  const QStatCard = ({ title, value, sub, color }) => (
    <div style={{ background:"white", borderRadius:10, padding:"1rem", border:"1px solid #e2ecf7", textAlign:"center" }}>
      <div style={{ fontSize:"2rem", fontWeight:800, color }}>{value}</div>
      <div style={{ fontSize:"0.8rem", fontWeight:700, color:"#1a3a5c" }}>{title}</div>
      {sub && <div style={{ fontSize:"0.7rem", color:"#718096", marginTop:"0.2rem" }}>{sub}</div>}
    </div>
  );

  const DomainBar = ({ label, pct, count }) => {
    const color = pct===null ? "#cbd5e0" : pct>=90 ? "#22863a" : pct>=70 ? "#d97706" : "#c53030";
    return (
      <div style={{ marginBottom:"0.55rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.75rem", color:"#4a5568", marginBottom:"0.15rem" }}>
          <span>{label}</span>
          <span style={{ fontWeight:700, color:"#1a3a5c" }}>{pct===null ? "—" : `${pct}%`} <span style={{ color:"#94a3b8", fontWeight:500 }}>(n={count})</span></span>
        </div>
        <div style={{ background:"#f0f4f8", borderRadius:4, height:14, overflow:"hidden" }}>
          <div style={{ width:`${pct??0}%`, background:color, height:"100%", borderRadius:4, transition:"width 0.4s" }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop:"0.8rem" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:"0.7rem", marginBottom:"0.8rem" }}>
        <QStatCard title="Total Assessments" value={totalScored} sub="Consultant-scored" color="#2b7de9" />
        <QStatCard title="Appropriate" value={appropriate} sub={`${pctOf(appropriate)}% · ≥90%`} color="#22863a" />
        <QStatCard title="Partially Appropriate" value={partial} sub={`${pctOf(partial)}% · 70–89%`} color="#d97706" />
        <QStatCard title="Not Appropriate" value={notAppropriate} sub={`${pctOf(notAppropriate)}% · <70%`} color="#c53030" />
      </div>

      <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7" }}>
        <SH>Domain-Level Performance (cumulative %, weakest first)</SH>
        <div style={{ fontSize:"0.68rem", color:"#718096", marginBottom:"0.6rem" }}>Average of all consultant scores per domain, as % of max (2 pts/domain). Lowest domains indicate where the AI most needs improvement.</div>
        {domainStats.map(d => <DomainBar key={d.key} label={d.label} pct={d.pct} count={d.count} />)}
      </div>
    </div>
  );
}

// ─── CONSULTANT REVIEW ────────────────────────────────────────────────────────
// ─── CONSULTANT REVIEW DOMAINS ────────────────────────────────────────────────
// 10 domains × 0/1/2 scale (Not appropriate / Partially appropriate / Appropriate)
// Max score = 20. >90% Appropriate · 70–89% Partially appropriate · <70% Not appropriate
const REVIEW_DOMAINS = [
  { key: "riskStratification", label: "Risk Stratification & ASA-PS", hint: "Cardiac/pulmonary/OSA risk scoring, aspiration risk, airway prediction, ASA-PS accuracy" },
  { key: "techniqueChoice",    label: "Anaesthetic Technique Choice", hint: "GA vs regional vs combined — appropriately compared and justified" },
  { key: "airwayPlan",         label: "Airway Plan", hint: "Primary/backup plan, RSI decision where indicated" },
  { key: "monitoringPlan",     label: "Monitoring Plan", hint: "Invasive monitoring decisions appropriately justified" },
  { key: "inductionMaintenance", label: "Induction & Maintenance", hint: "Drug choices, doses, TIVA vs volatile, NMB and reversal" },
  { key: "regionalModule",     label: "Regional Anaesthesia Module", hint: "All applicable techniques considered; correct selection" },
  { key: "fluidManagement",    label: "Fluid Management Strategy", hint: "Individualised, appropriate triggers and targets" },
  { key: "analgesiaPlan",      label: "Postoperative Analgesia", hint: "Multimodal, PONV prophylaxis appropriate to risk" },
  { key: "postopDestination",  label: "Postoperative Destination", hint: "Ward/HDU/ICU decision appropriately justified" },
  { key: "safetyAudit",        label: "Safety Audit Completeness", hint: "All safety-critical checks genuinely addressed, not just ticked" },
];

const SCORE_LABELS = { 0: "Not appropriate", 1: "Partially appropriate", 2: "Appropriate" };
const SCORE_COLORS = { 0: "#c53030", 1: "#d97706", 2: "#22863a" };

function computeOverallVerdict(scores) {
  const vals = REVIEW_DOMAINS.map(d => scores[d.key]).filter(v => v !== undefined);
  if (vals.length < REVIEW_DOMAINS.length) return null;
  const total = vals.reduce((a,b)=>a+b, 0);
  const pct = (total / 20) * 100;
  let verdict, color;
  if (pct >= 90) { verdict = "Appropriate"; color = "#22863a"; }
  else if (pct >= 70) { verdict = "Partially Appropriate"; color = "#d97706"; }
  else { verdict = "Not Appropriate"; color = "#c53030"; }
  return { total, pct: Math.round(pct), verdict, color };
}

// ─── CONSULTANT PASSWORD GATE ─────────────────────────────────────────────────
// Simple shared-password gate so only consultants can submit scored reviews.
// Change CONSULTANT_PASSWORD below to whatever your department agrees on.
const CONSULTANT_PASSWORD = "consultant2026";
const AUTH_KEY = "acrf_consultant_auth";

function isConsultantAuthed() {
  try { return sessionStorage.getItem(AUTH_KEY) === "true"; } catch { return false; }
}
function setConsultantAuthed(val) {
  try { sessionStorage.setItem(AUTH_KEY, val ? "true" : "false"); } catch {}
}

function PasswordGate({ onUnlock }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (pw === CONSULTANT_PASSWORD) {
      setConsultantAuthed(true);
      setError("");
      onUnlock();
    } else {
      setError("Incorrect password. Please check with your department lead.");
    }
  };

  return <div style={{ background:"white", borderRadius:12, padding:"2rem 1.5rem", border:"1px solid #e2ecf7", maxWidth:420, margin:"2rem auto", textAlign:"center" }}>
    <div style={{ fontSize:"2.2rem", marginBottom:"0.6rem" }}>🔐</div>
    <div style={{ fontWeight:700, fontSize:"1rem", color:"#1a3a5c", marginBottom:"0.4rem" }}>Consultant Review Access</div>
    <p style={{ fontSize:"0.8rem", color:"#718096", marginBottom:"1.1rem", lineHeight:1.6 }}>
      This section is restricted to consultant anaesthesiologists scoring AI-generated plans. Enter the department password to continue.
    </p>
    <input
      type="password"
      value={pw}
      onChange={e=>setPw(e.target.value)}
      onKeyDown={e=>e.key==="Enter" && submit()}
      placeholder="Password"
      style={{ width:"100%", padding:"0.6rem 0.8rem", borderRadius:8, border:"1.5px solid #e2e8f0", fontSize:"0.9rem", outline:"none", boxSizing:"border-box", marginBottom:"0.8rem", fontFamily:"inherit", textAlign:"center" }}
    />
    {error && <div style={{ fontSize:"0.78rem", color:"#c53030", marginBottom:"0.8rem" }}>{error}</div>}
    <Btn onClick={submit} style={{ width:"100%", background:"#2b7de9", color:"white", padding:"0.65rem", fontSize:"0.88rem" }}>
      Unlock Consultant Review
    </Btn>
  </div>;
}

// ─── DOMAIN SCORING FORM ──────────────────────────────────────────────────────
function DomainScoringForm({ scores, setScores }) {
  const setScore = (key, val) => setScores(prev => ({ ...prev, [key]: val }));
  return <div>
    {REVIEW_DOMAINS.map(d => (
      <div key={d.key} style={{ padding:"0.6rem 0", borderBottom:"1px solid #f0f4f8" }}>
        <div style={{ fontSize:"0.84rem", fontWeight:700, color:"#1a3a5c", marginBottom:"0.15rem" }}>{d.label}</div>
        <div style={{ fontSize:"0.72rem", color:"#718096", marginBottom:"0.45rem" }}>{d.hint}</div>
        <div style={{ display:"flex", gap:"0.4rem" }}>
          {[0,1,2].map(v => (
            <button key={v} onClick={()=>setScore(d.key, v)} style={{
              flex:1, padding:"0.4rem 0.3rem", borderRadius:7,
              border:`1.5px solid ${scores[d.key]===v ? SCORE_COLORS[v] : "#e2e8f0"}`,
              background: scores[d.key]===v ? SCORE_COLORS[v]+"18" : "white",
              color: scores[d.key]===v ? SCORE_COLORS[v] : "#94a3b8",
              fontWeight: scores[d.key]===v ? 700 : 500,
              fontSize:"0.74rem", cursor:"pointer", fontFamily:"inherit"
            }}>
              {v} · {SCORE_LABELS[v]}
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>;
}

// ─── CONSULTANT REVIEW ────────────────────────────────────────────────────────
function ConsultantReview({ entries, onScoreSaved }) {
  const [authed, setAuthed] = useState(isConsultantAuthed());
  const [selectedId, setSelectedId] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const scoreRef = useRef(null);

  const selected = entries.find(e => e.id === selectedId);
  const verdict = computeOverallVerdict(scores);
  const allScored = REVIEW_DOMAINS.every(d => scores[d.key] !== undefined);

  const handleSelectCase = (id) => {
    setSelectedId(id);
    const entry = entries.find(e => e.id === id);
    // Pre-fill with existing review if one exists, otherwise reset
    if (entry?.consultantScoring) {
      setScores(entry.consultantScoring.scores || {});
      setComments(entry.consultantScoring.comments || "");
      setReviewerName(entry.consultantScoring.reviewerName || "");
    } else {
      setScores({});
      setComments("");
    }
  };

  const handleSaveScore = async () => {
    if (!selected) { alert("Please select a case first."); return; }
    if (!allScored) { alert("Please score all 10 domains before saving."); return; }
    if (!reviewerName.trim()) { alert("Please enter the reviewing consultant's name."); return; }
    setSaving(true);
    try {
      const updatedEntry = {
        ...selected,
        consultantScoring: {
          reviewerName: reviewerName.trim(),
          scores,
          comments,
          total: verdict.total,
          pct: verdict.pct,
          verdict: verdict.verdict,
          reviewedAt: new Date().toISOString(),
        }
      };
      const ok = await dbUpdateEntry(updatedEntry);
      if (ok) {
        onScoreSaved && onScoreSaved(updatedEntry);
        alert(`Score saved: ${verdict.total}/20 (${verdict.pct}%) — ${verdict.verdict}`);
      } else {
        alert("Save failed — please try again.");
      }
    } catch(e) {
      alert("Save error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!authed) {
    return <PasswordGate onUnlock={()=>setAuthed(true)} />;
  }

  if (entries.length===0) return (
    <div style={{ textAlign:"center", padding:"3rem 1rem", color:"#718096" }}>
      <div style={{ fontSize:"2.5rem", marginBottom:"0.5rem" }}>🔍</div>
      <div style={{ fontWeight:600 }}>No cases available for review</div>
      <div style={{ fontSize:"0.8rem", marginTop:"0.3rem" }}>Save assessments first, then use this tab to score them.</div>
    </div>
  );

  return <div>
    <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:"0.5rem" }}>
      <button onClick={()=>{ setConsultantAuthed(false); setAuthed(false); }} style={{ fontSize:"0.7rem", color:"#94a3b8", background:"none", border:"none", cursor:"pointer", textDecoration:"underline", fontFamily:"inherit" }}>
        🔓 Lock consultant review
      </button>
    </div>

    <div style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7", marginBottom:"0.8rem" }}>
      <SH>🔍 Consultant Domain Scoring</SH>
      <p style={{ fontSize:"0.75rem", color:"#718096", margin:"0 0 0.6rem", lineHeight:1.5 }}>
        Score the AI-generated plan across 10 domains. Each domain: <strong>0</strong> = Not appropriate, <strong>1</strong> = Partially appropriate, <strong>2</strong> = Appropriate. Max total = 20.
        <br/>&gt;90% = Appropriate · 70–89% = Partially Appropriate · &lt;70% = Not Appropriate.
      </p>

      <G cols={2}>
        <F label="Select Case to Review">
          <select value={selectedId} onChange={e=>handleSelectCase(e.target.value)} style={{ width:"100%", padding:"0.45rem 0.6rem", borderRadius:6, border:"1.5px solid #e2e8f0", fontSize:"0.81rem", color:"#2d3748", outline:"none", background:"white", fontFamily:"inherit" }}>
            <option value="">— Select a saved case —</option>
            {[...entries].sort((a,b)=>new Date(b.savedAt||0)-new Date(a.savedAt||0)).map(e => (
              <option key={e.id} value={e.id}>
                {e.formData?.age}yo {e.formData?.sex} · {e.formData?.surgery||"Unknown"} ({e.formData?.urgency}) · {e.savedAt?new Date(e.savedAt).toLocaleDateString():""}{e.consultantScoring ? " ✓ scored" : ""}
              </option>
            ))}
          </select>
        </F>
        <F label="Reviewing Consultant's Name">
          <Inp value={reviewerName} onChange={setReviewerName} placeholder="e.g. Dr. A. Sharma" />
        </F>
      </G>

      {selected && (
        <div style={{ marginTop:"0.6rem", background:"#f7faff", borderRadius:8, padding:"0.6rem 0.8rem", fontSize:"0.78rem", color:"#4a5568", lineHeight:1.6 }}>
          <strong>Case summary:</strong> ASA {selected.formData?.asaGrade||"?"} · {selected.formData?.surgery} · RCRI {selected.rcri?.score}/6 ({selected.rcri?.risk}) · ARISCAT {selected.ariscat?.score} ({selected.ariscat?.risk})
          {selected.consultantScoring && (
            <div style={{ marginTop:"0.4rem", padding:"0.4rem 0.6rem", background:SCORE_COLORS[selected.consultantScoring.pct>=90?2:selected.consultantScoring.pct>=70?1:0]+"18", borderRadius:6, color:SCORE_COLORS[selected.consultantScoring.pct>=90?2:selected.consultantScoring.pct>=70?1:0], fontWeight:700 }}>
              ✓ Previously scored by {selected.consultantScoring.reviewerName}: {selected.consultantScoring.total}/20 ({selected.consultantScoring.pct}%) — {selected.consultantScoring.verdict}
            </div>
          )}
        </div>
      )}
    </div>

    {selected && (
      <div ref={scoreRef} style={{ background:"white", borderRadius:10, padding:"0.9rem", border:"1px solid #e2ecf7", marginBottom:"0.8rem" }}>
        <SH>📋 AI-Generated Plan (for reference)</SH>
        <div style={{ background:"#f7faff", borderRadius:8, padding:"0.7rem", fontSize:"0.8rem", color:"#2d3748", maxHeight:300, overflowY:"auto", lineHeight:1.6, marginBottom:"1rem" }}>
          {renderMarkdown(selected.result)}
        </div>

        <SH>📊 Domain Scoring (0 / 1 / 2)</SH>
        <DomainScoringForm scores={scores} setScores={setScores} />

        <div style={{ marginTop:"0.8rem" }}>
          <F label="Comments / Specific Feedback (optional)">
            <textarea value={comments} onChange={e=>setComments(e.target.value)} placeholder="e.g. Regional technique selection was suboptimal given coagulation status. Fluid strategy was appropriate." style={{ width:"100%", minHeight:80, padding:"0.45rem 0.6rem", borderRadius:6, border:"1.5px solid #e2e8f0", fontSize:"0.81rem", color:"#2d3748", outline:"none", fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
          </F>
        </div>

        {verdict && (
          <div style={{ marginTop:"0.9rem", background:verdict.color+"15", border:`1.5px solid ${verdict.color}40`, borderRadius:10, padding:"0.8rem 1rem", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.6rem" }}>
            <div>
              <div style={{ fontSize:"0.7rem", color:"#718096", textTransform:"uppercase", letterSpacing:"0.05em" }}>Total Score</div>
              <div style={{ fontSize:"1.4rem", fontWeight:800, color:verdict.color }}>{verdict.total}/20 ({verdict.pct}%)</div>
            </div>
            <div style={{ fontSize:"1rem", fontWeight:700, color:verdict.color, background:"white", padding:"0.4rem 0.9rem", borderRadius:8, border:`1.5px solid ${verdict.color}` }}>
              {verdict.verdict}
            </div>
          </div>
        )}

        {!allScored && (
          <div style={{ marginTop:"0.7rem", fontSize:"0.76rem", color:"#d97706" }}>
            ⚠️ {REVIEW_DOMAINS.filter(d=>scores[d.key]===undefined).length} of 10 domains not yet scored.
          </div>
        )}

        <Btn onClick={handleSaveScore} disabled={saving || !allScored} style={{ marginTop:"0.8rem", width:"100%", background:saving||!allScored?"#a0aec0":"#2b7de9", color:"white", padding:"0.7rem", fontSize:"0.88rem" }}>
          {saving ? "Saving…" : "💾 Save Consultant Score to Case"}
        </Btn>
      </div>
    )}
  </div>;
}

// ─── HISTORY VIEW ─────────────────────────────────────────────────────────────
function HistoryView({ entries, onDelete, onReopen, onRefresh }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);

  const filtered = [...entries]
    .filter(e => {
      const q = search.toLowerCase();
      return !q || (e.formData?.surgery||"").toLowerCase().includes(q) || (e.formData?.age||"").toString().includes(q) || (e.formData?.urgency||"").toLowerCase().includes(q);
    })
    .sort((a,b)=>new Date(b.savedAt||0)-new Date(a.savedAt||0));

  if (entries.length===0) return (
    <div style={{ textAlign:"center", padding:"3rem 1rem", color:"#718096" }}>
      <div style={{ fontSize:"2.5rem", marginBottom:"0.5rem" }}>📁</div>
      <div style={{ fontWeight:600 }}>No saved cases yet</div>
      <div style={{ fontSize:"0.8rem", marginTop:"0.3rem" }}>Complete an assessment and click "Save to Shared History".</div>
      <div style={{ fontSize:"0.75rem", marginTop:"0.3rem", color:"#a0aec0" }}>Cases are shared across everyone using this artifact link.</div>
    </div>
  );

  return <div>
    <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.6rem" }}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by procedure, age, urgency…" style={{ flex:1, padding:"0.5rem 0.7rem", borderRadius:8, border:"1.5px solid #e2e8f0", fontSize:"0.82rem", fontFamily:"inherit", outline:"none" }} />
      <Btn onClick={onRefresh} style={{ background:"#f0f4f8", color:"#4a5568", fontSize:"0.75rem", padding:"0.4rem 0.7rem" }}>⟳ Refresh</Btn>
      <div style={{ fontSize:"0.72rem", color:"#718096", whiteSpace:"nowrap" }}>{filtered.length} of {entries.length} case{entries.length!==1?"s":""}</div>
    </div>
    <div style={{ fontSize:"0.7rem", color:"#a0aec0", marginBottom:"0.6rem" }}>🌐 Shared history — visible to all users of this artifact link</div>

    {filtered.map(e => {
      const isOpen = expanded===e.id;
      const rc = riskColor(e.rcri?.risk||"");
      return <div key={e.id} style={{ background:"white", border:"1px solid #e2ecf7", borderRadius:10, marginBottom:"0.5rem", overflow:"hidden" }}>
        <div style={{ padding:"0.75rem 0.9rem", display:"flex", alignItems:"center", gap:"0.6rem", cursor:"pointer" }} onClick={()=>setExpanded(isOpen?null:e.id)}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:rc, flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:"0.85rem", color:"#1a3a5c", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {e.formData?.age}yo {e.formData?.sex} · {e.formData?.surgery||"Unknown procedure"}
            </div>
            <div style={{ fontSize:"0.72rem", color:"#718096", marginTop:"0.1rem" }}>
              ASA {e.formData?.asaGrade||"?"}{e.formData?.urgency==="Emergency"?"E":""} · {e.formData?.urgency} · {e.savedAt?new Date(e.savedAt).toLocaleString():""}
              {e.consultantScoring && <span style={{ marginLeft:"0.4rem", color:SCORE_COLORS[e.consultantScoring.pct>=90?2:e.consultantScoring.pct>=70?1:0], fontWeight:700 }}>· 🔍 {e.consultantScoring.total}/20 ({e.consultantScoring.verdict})</span>}
            </div>
          </div>
          <div style={{ display:"flex", gap:"0.3rem", flexShrink:0 }}>
            {e.rcri && <span style={{ fontSize:"0.68rem", background:rc+"18", color:rc, border:`1px solid ${rc}40`, borderRadius:6, padding:"0.15rem 0.4rem", fontWeight:700 }}>RCRI {e.rcri.score}/6</span>}
            {e.ariscat && <span style={{ fontSize:"0.68rem", background:"#3b82f618", color:"#3b82f6", border:"1px solid #3b82f640", borderRadius:6, padding:"0.15rem 0.4rem", fontWeight:700 }}>ARISCAT {e.ariscat.score}</span>}
          </div>
          <span style={{ color:"#a0aec0", fontSize:"0.75rem" }}>{isOpen?"▲":"▼"}</span>
        </div>

        {isOpen && <div style={{ borderTop:"1px solid #f0f4f8", padding:"0.75rem 0.9rem" }}>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem", marginBottom:"0.6rem" }}>
            {e.rcri && <Badge label="RCRI" value={`${e.rcri.score}/6 · ${e.rcri.risk}`} color={riskColor(e.rcri.risk)} />}
            {e.ariscat && <Badge label="ARISCAT" value={`${e.ariscat.score} · ${e.ariscat.risk}`} color={riskColor(e.ariscat.risk)} />}
            {e.stopbang && <Badge label="STOP-BANG" value={`${e.stopbang.score}/8 · ${e.stopbang.risk}`} color={riskColor(e.stopbang.risk)} />}
          </div>
          <div style={{ background:"#f7faff", borderRadius:8, padding:"0.7rem", fontSize:"0.82rem", color:"#2d3748", maxHeight:420, overflowY:"auto", lineHeight:1.6 }}>
            {renderMarkdown(e.result)}
          </div>
          {e.consultantScoring && <div style={{ marginTop:"0.7rem", background:"#f7faff", border:`1.5px solid ${SCORE_COLORS[e.consultantScoring.pct>=90?2:e.consultantScoring.pct>=70?1:0]}40`, borderRadius:8, padding:"0.7rem" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
              <div style={{ fontSize:"0.74rem", fontWeight:700, color:"#1a3a5c" }}>🔍 Consultant Score — {e.consultantScoring.reviewerName}</div>
              <div style={{ fontSize:"0.74rem", fontWeight:800, color:SCORE_COLORS[e.consultantScoring.pct>=90?2:e.consultantScoring.pct>=70?1:0] }}>{e.consultantScoring.total}/20 ({e.consultantScoring.pct}%) · {e.consultantScoring.verdict}</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.25rem 0.7rem", marginBottom:"0.5rem" }}>
              {REVIEW_DOMAINS.map(d => {
                const v = e.consultantScoring.scores?.[d.key];
                return <div key={d.key} style={{ display:"flex", justifyContent:"space-between", fontSize:"0.7rem", color:"#4a5568" }}>
                  <span>{d.label}</span>
                  <span style={{ fontWeight:700, color: v!==undefined ? SCORE_COLORS[v] : "#cbd5e1" }}>{v!==undefined ? `${v} · ${SCORE_LABELS[v]}` : "—"}</span>
                </div>;
              })}
            </div>
            {e.consultantScoring.comments && <div style={{ fontSize:"0.76rem", color:"#2d3748", background:"white", borderRadius:6, padding:"0.5rem 0.6rem", lineHeight:1.5 }}>
              <strong>Comments:</strong> {e.consultantScoring.comments}
            </div>}
            <div style={{ fontSize:"0.68rem", color:"#94a3b8", marginTop:"0.4rem" }}>Reviewed {new Date(e.consultantScoring.reviewedAt).toLocaleString()}</div>
          </div>}
          <div style={{ display:"flex", gap:"0.5rem", marginTop:"0.6rem" }}>
            <Btn onClick={()=>onReopen(e)} style={{ background:"#ebf4ff", color:"#2b7de9", fontSize:"0.78rem", padding:"0.35rem 0.8rem" }}>↩ Re-open Assessment</Btn>
            <Btn onClick={()=>onDelete(e.id)} style={{ background:"#fff5f5", color:"#c53030", fontSize:"0.78rem", padding:"0.35rem 0.8rem" }}>🗑 Delete</Btn>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("assess");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [result, setResult] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [dbStatus, setDbStatus] = useState("connecting"); // connecting | ok | error
  const [dbErrorDetail, setDbErrorDetail] = useState("");
  const [pendingEntry, setPendingEntry] = useState(null);
  const resultRef = useRef(null);
  const latestResultRef = useRef(null);
  const latestPendingRef = useRef(null);

  const refreshEntries = async () => {
    setLoadingHistory(true);
    setDbStatus("connecting");
    setDbErrorDetail("");
    try {
      const rows = await dbReadAll();
      setEntries(rows);
      setDbStatus("ok");
    } catch(e) {
      console.error("Storage connection error:", e);
      setDbStatus("error");
      setDbErrorDetail(`${e.name || "Error"}: ${e.message || String(e)}`);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => { refreshEntries(); }, []);

  // Refresh from Supabase when switching to non-assess tabs
  useEffect(() => {
    if (tab !== "assess") refreshEntries();
  }, [tab]);

  const handleSubmit = async ({ caseText, scoresText, formData, rcri, ariscat, stopbang }) => {
    setLoading(true);
    setResult(null);
    latestResultRef.current = null;
    setSaved(false);
    setStreaming(false);
    setTruncated(false);
    const pending = { caseText, formData, rcri, ariscat, stopbang };
    setPendingEntry(pending);
    latestPendingRef.current = pending;
    try {
      const res = await fetch("/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          max_tokens:16000,
          stream:true,
          system:buildSystemPrompt(scoresText),
          messages:[{ role:"user", content:`Please generate the full 12-stage anaesthetic plan for:\n\n${caseText}` }]
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let stopReason = null;
      setLoading(false);
      setStreaming(true);
      setTruncated(false);
      setResult("");
      setResultMeta({ rcri, ariscat, stopbang });
      setTimeout(()=>resultRef.current?.scrollIntoView({ behavior:"smooth" }),100);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream:true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.delta?.text || parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (delta) {
                fullText += delta;
                latestResultRef.current = fullText;
                setResult(fullText);
              }
              // Detect truncation
              if (parsed?.delta?.stop_reason === "max_tokens" || parsed?.message?.stop_reason === "max_tokens" || parsed?.candidates?.[0]?.finishReason === "MAX_TOKENS") {
                stopReason = "max_tokens";
              }
            } catch {}
          }
        }
      }
      setStreaming(false);
      if (stopReason === "max_tokens") setTruncated(true);
      if (!fullText) throw new Error("Empty response from API");
    } catch(e) {
      setLoading(false);
      setStreaming(false);
      alert("Assessment failed: "+e.message);
    }
  };

  const handleContinue = async () => {
    const currentResult = latestResultRef.current;
    const currentPending = latestPendingRef.current;
    if (!currentResult || !currentPending) return;
    setStreaming(true);
    setTruncated(false);
    try {
      const res = await fetch("/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          max_tokens:16000,
          stream:true,
          system:buildSystemPrompt(`RCRI: ${currentPending.rcri.score}/6 → ${currentPending.rcri.risk}\nARISCAT: ${currentPending.ariscat.score} → ${currentPending.ariscat.risk}\nSTOP-BANG: ${currentPending.stopbang.score}/8 → ${currentPending.stopbang.risk}`),
          messages:[
            { role:"user", content:`Please generate the full 12-stage anaesthetic plan for:\n\n${currentPending.caseText}` },
            { role:"assistant", content: currentResult },
            { role:"user", content:"Please continue exactly from where you left off. Do not repeat anything already written. Continue the plan from the exact point it was cut off." }
          ]
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let continuation = "";
      let stopReason = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream:true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.delta?.text || parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (delta) {
                continuation += delta;
                const combined = currentResult + continuation;
                latestResultRef.current = combined;
                setResult(combined);
              }
              if (parsed?.delta?.stop_reason === "max_tokens" || parsed?.message?.stop_reason === "max_tokens" || parsed?.candidates?.[0]?.finishReason === "MAX_TOKENS") {
                stopReason = "max_tokens";
              }
            } catch {}
          }
        }
      }
      setStreaming(false);
      if (stopReason === "max_tokens") setTruncated(true);
    } catch(e) {
      setStreaming(false);
      alert("Continue failed: " + e.message);
    }
  };

  const handleSave = async () => {
    const currentResult = latestResultRef.current;
    const currentPending = latestPendingRef.current;
    if (!currentResult || !currentPending) {
      alert("Nothing to save yet — please generate an assessment first.");
      return;
    }
    setSaving(true);
    try {
      const entry = {
        id: Math.random().toString(36).slice(2,10),
        savedAt: new Date().toISOString(),
        caseText: currentPending.caseText,
        formData: currentPending.formData,
        rcri: currentPending.rcri,
        ariscat: currentPending.ariscat,
        stopbang: currentPending.stopbang,
        result: currentResult,
      };
      console.log("Attempting save:", entry.id);
      const ok = await dbWriteEntry(entry);
      console.log("Save result:", ok);
      if (ok) {
        setEntries(prev => [entry, ...prev]);
        setSaved(true);
      } else {
        alert("⚠️ Save failed. Open the browser console (or long-press → Inspect) for the exact error, then share it.");
      }
    } catch(e) {
      console.error("Save exception:", e);
      alert("Save error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this case from shared history?")) return;
    const ok = await dbDeleteEntry(id);
    if (ok) setEntries(prev => prev.filter(e => e.id !== id));
    else alert("Delete failed — please try again.");
  };

  const handleReopen = (entry) => {
    setResult(entry.result);
    setResultMeta({ rcri:entry.rcri, ariscat:entry.ariscat, stopbang:entry.stopbang });
    setSaved(true);
    setTab("assess");
    setTimeout(()=>resultRef.current?.scrollIntoView({ behavior:"smooth" }),200);
  };

  const savedCount = entries.length;

  return (
    <div style={{ fontFamily:"'Inter',system-ui,sans-serif", background:"#f0f4f8", minHeight:"100vh" }}>
      <div style={{ background:"linear-gradient(135deg,#1a3a5c 0%,#2b7de9 100%)", color:"white", padding:"0.8rem 1.2rem", display:"flex", alignItems:"center", gap:"0.75rem", flexWrap:"wrap" }}>
        <div style={{ fontSize:"1.5rem" }}>⚕️</div>
        <div>
          <div style={{ fontWeight:800, fontSize:"1rem", letterSpacing:"-0.3px" }}>ACRF — AI Anaesthesia Risk &amp; Surgical Planning</div>
          <div style={{ fontSize:"0.68rem", opacity:0.75, letterSpacing:"0.03em" }}>12-Stage Expert Perioperative Assessment · Shared Case History</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"0.5rem", flexWrap:"wrap" }}>
          <div style={{ fontSize:"0.68rem", borderRadius:6, padding:"0.2rem 0.55rem", fontWeight:700, background: dbStatus==="ok"?"#22863a33":dbStatus==="error"?"#c5303033":"#71809633", color: dbStatus==="ok"?"#86efac":dbStatus==="error"?"#fca5a5":"#cbd5e1", border:`1px solid ${dbStatus==="ok"?"#22863a55":dbStatus==="error"?"#c5303055":"#71809655"}` }}>
            {dbStatus==="ok"?"🟢 Database connected":dbStatus==="error"?"🔴 Storage error — click ⟳":"⏳ Connecting…"}
          </div>
          <button onClick={refreshEntries} style={{ fontSize:"0.75rem", background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:6, padding:"0.25rem 0.55rem", color:"white", cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>⟳</button>
          <div style={{ fontSize:"0.65rem", background:"rgba(255,255,255,0.15)", borderRadius:6, padding:"0.25rem 0.6rem", lineHeight:1.5, textAlign:"right" }}>
            ⚠ Clinical decision support only.<br/>Not a substitute for clinical judgement.
          </div>
        </div>
      </div>

      <div style={{ background:"white", borderBottom:"1px solid #e2ecf7", display:"flex", paddingLeft:"1rem", overflowX:"auto" }}>
        <TabBtn label="📋 New Assessment" active={tab==="assess"} onClick={()=>setTab("assess")} />
        <TabBtn label="📁 Case History" active={tab==="history"} onClick={()=>setTab("history")} count={savedCount} />
        <TabBtn label="📊 Dashboard" active={tab==="dashboard"} onClick={()=>setTab("dashboard")} />
        <TabBtn label="🔍 Consultant Review" active={tab==="review"} onClick={()=>setTab("review")} />
      </div>

      <div style={{ maxWidth:920, margin:"0 auto", padding:"1rem" }}>
        {tab==="assess" && <>
          <StructuredForm onSubmit={handleSubmit} loading={loading} />
          {loading && (
            <div style={{ textAlign:"center", padding:"2rem", color:"#2b7de9", background:"white", borderRadius:10, border:"1px solid #e2ecf7", marginTop:"0.8rem" }}>
              <div style={{ fontSize:"1.5rem", marginBottom:"0.5rem" }}>⏳</div>
              <div style={{ fontWeight:600 }}>Generating 12-stage anaesthetic plan…</div>
              <div style={{ fontSize:"0.78rem", color:"#718096", marginTop:"0.3rem" }}>This may take 15–30 seconds</div>
            </div>
          )}
          {result && resultMeta && (
            <div ref={resultRef} style={{ marginTop:"1rem" }}>
              <ResultDisplay result={result} meta={resultMeta} onSave={handleSave} saving={saving} saved={saved} streaming={streaming} truncated={truncated} onContinue={handleContinue} />
            </div>
          )}
        </>}

        {tab==="history" && (loadingHistory
          ? <div style={{ textAlign:"center", padding:"2rem", color:"#718096" }}>⏳ Loading from Supabase…</div>
          : dbStatus==="error"
            ? <div style={{ textAlign:"center", padding:"2rem", background:"#fff5f5", borderRadius:12, border:"1px solid #fca5a5" }}>
                <div style={{ fontSize:"1.5rem", marginBottom:"0.5rem" }}>🔴</div>
                <div style={{ fontWeight:700, color:"#c53030", marginBottom:"0.4rem" }}>Could not connect to database</div>
                <div style={{ fontSize:"0.8rem", color:"#718096", marginBottom:"0.8rem" }}>Check that your Supabase project is active and the table exists.</div>
                {dbErrorDetail && <div style={{ fontSize:"0.72rem", color:"#c53030", background:"white", border:"1px solid #fca5a5", borderRadius:6, padding:"0.5rem 0.7rem", marginBottom:"0.8rem", fontFamily:"monospace", wordBreak:"break-word", textAlign:"left" }}>{dbErrorDetail}</div>}
                <button onClick={refreshEntries} style={{ padding:"0.5rem 1.2rem", background:"#2b7de9", color:"white", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>⟳ Retry</button>
              </div>
            : <HistoryView entries={entries} onDelete={handleDelete} onReopen={handleReopen} onRefresh={refreshEntries} />
        )}

        {tab==="dashboard" && <CaseDashboard entries={entries} />}

        {tab==="review" && <ConsultantReview entries={entries} onScoreSaved={(updated)=>setEntries(prev=>prev.map(e=>e.id===updated.id?updated:e))} />}
      </div>
    </div>
  );
}
