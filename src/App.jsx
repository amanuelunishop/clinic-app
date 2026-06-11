import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase.js";

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL  = "https://gvcubfqflxmfuikoqhdl.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Y3ViZnFmbHhtZnVpa29xaGRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTI4ODgsImV4cCI6MjA5NjMyODg4OH0.xHSnCdIRp311QnbHeyyxKSwm8t25dF2OjeLyEB-hE3Q";

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  teal:   { 50:"#E1F5EE", 100:"#9FE1CB", 400:"#1D9E75", 600:"#0F6E56", 800:"#085041" },
  blue:   { 50:"#E6F1FB", 100:"#B5D4F4", 400:"#378ADD", 600:"#185FA5", 800:"#0C447C" },
  amber:  { 50:"#FAEEDA", 100:"#FAC775", 400:"#BA7517", 600:"#854F0B", 800:"#633806" },
  purple: { 50:"#EEEDFE", 100:"#CECBF6", 400:"#7F77DD", 600:"#534AB7", 800:"#3C3489" },
  red:    { 50:"#FCEBEB", 100:"#F7C1C1", 400:"#E24B4A", 600:"#A32D2D", 800:"#791F1F" },
  green:  { 50:"#EAF3DE", 100:"#C0DD97", 400:"#639922", 600:"#3B6D11", 800:"#27500A" },
  gray:   { 50:"#F1EFE8", 100:"#D3D1C7", 400:"#888780", 600:"#5F5E5A", 800:"#444441" },
};

const ROLES = {
  reception: { label:"Reception",    icon:"🏥", color:C.blue,   email:"reception@clinic.com", password:"clinic123" },
  doctor:    { label:"Doctor",       icon:"🩺", color:C.teal,   email:"doctor@clinic.com",    password:"clinic123" },
  lab:       { label:"Lab Assistant",icon:"🔬", color:C.purple, email:"lab@clinic.com",        password:"clinic123" },
};

const OWNER_EMAIL    = "owner@clinic.com";
const OWNER_PASSWORD = "owner123";

const LAB_TESTS = [
  "Complete Blood Count (CBC)","Blood Glucose","Liver Function Test",
  "Kidney Function Test","Urinalysis","Stool Analysis",
  "Lipid Panel","Thyroid Function (TSH)","Blood Culture",
  "HIV Test","Malaria Test","Hepatitis B/C",
];

// ── Auth helpers ──────────────────────────────────────────────────────────────
function getToken()   { return localStorage.getItem("clinic_token"); }
function setToken(t)  { localStorage.setItem("clinic_token", t); }
function clearToken() { localStorage.removeItem("clinic_token"); }
function getRole()    { return localStorage.getItem("clinic_role"); }
function setRole(r)   { localStorage.setItem("clinic_role", r); }
function clearRole()  { localStorage.removeItem("clinic_role"); }

// ── Supabase auth ─────────────────────────────────────────────────────────────
async function supabaseLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Login failed");
  return data.access_token;
}

// ── Patient helpers ───────────────────────────────────────────────────────────
function parseMeta(patient) {
  try { return JSON.parse(patient.notes || "{}"); } catch { return {}; }
}

function toDisplay(patient) {
  const m = parseMeta(patient);
  return {
    id:              patient.id,
    name:            `${patient.first_name} ${patient.last_name}`.trim(),
    phone:           patient.phone || "",
    address:         patient.address || "",
    createdAt:       patient.created_at,
    patient_number:  patient.patient_number,
    age:             m.age || "",
    bp:              m.bp || "",
    status:          m.clinicStatus || "registered",
    doctorNotes:     m.doctorNotes || null,
    labResults:      m.labResults || null,
    labNotes:        m.labNotes || null,
    diagnosis:       m.diagnosis || null,
    appointmentDate: m.appointmentDate || null,
  };
}

async function fetchAllPatients() {
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data || []).map(toDisplay);
}

async function createPatient(form) {
  const [first_name, ...rest] = form.name.trim().split(" ");
  const last_name = rest.join(" ") || "-";
  const notes = JSON.stringify({ clinicStatus: "registered", age: form.age, bp: form.bp });
  const currentYear = new Date().getFullYear();
  const birthYear = form.age ? currentYear - parseInt(form.age) : currentYear;
  const date_of_birth = `${birthYear}-01-01`;
  const { data, error } = await supabase
    .from("patients")
    .insert({ first_name, last_name, phone: form.phone, address: form.address, notes, date_of_birth })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updatePatientNotes(id, display) {
  const meta = {
    clinicStatus:    display.status,
    age:             display.age,
    bp:              display.bp,
    doctorNotes:     display.doctorNotes,
    labResults:      display.labResults,
    labNotes:        display.labNotes,
    diagnosis:       display.diagnosis,
    appointmentDate: display.appointmentDate,
  };
  const { error } = await supabase
    .from("patients")
    .update({ notes: JSON.stringify(meta) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Global store ──────────────────────────────────────────────────────────────
let _patients = [];
let _loaded   = false;
const _listeners = new Set();
function notifyAll() { _listeners.forEach(fn => fn()); }

function useStore() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const cb = () => setTick(t => t + 1);
    _listeners.add(cb);
    if (!_loaded) {
      _loaded = true;
      fetchAllPatients().then(ps => { _patients = ps; notifyAll(); });
    }
    return () => _listeners.delete(cb);
  }, []);

  const update = useCallback(async (updater) => {
    const next = updater(_patients);
    _patients = next;
    notifyAll();
  }, []);

  return [_patients, update];
}

// ── UI primitives ─────────────────────────────────────────────────────────────
function Badge({ children, color = "gray" }) {
  const c = C[color] || C.gray;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", padding:"3px 10px",
      borderRadius:20, fontSize:11, fontWeight:700, letterSpacing:"0.04em",
      textTransform:"uppercase", background:c[50], color:c[800], border:`1px solid ${c[100]}` }}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, variant="teal", disabled, full }) {
  const styles = {
    teal:   { bg:C.teal[600],   fg:"#fff", br:`1px solid ${C.teal[800]}` },
    blue:   { bg:C.blue[600],   fg:"#fff", br:`1px solid ${C.blue[800]}` },
    purple: { bg:C.purple[600], fg:"#fff", br:`1px solid ${C.purple[800]}` },
    ghost:  { bg:"#fff",        fg:C.gray[800], br:`1px solid ${C.gray[100]}` },
    danger: { bg:C.red[50],     fg:C.red[800],  br:`1px solid ${C.red[100]}` },
  };
  const s = styles[variant] || styles.teal;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:s.bg, color:s.fg, border:s.br,
      padding:"10px 20px", borderRadius:10, fontSize:13, fontWeight:700,
      cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1,
      display:"inline-flex", alignItems:"center", gap:6, fontFamily:"inherit",
      width:full?"100%":"auto", justifyContent:"center", transition:"opacity 0.15s",
    }}>{children}</button>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background:"#fff", borderRadius:14, border:`1px solid ${C.gray[100]}`,
      boxShadow:"0 1px 3px rgba(0,0,0,0.06)", ...style }}>
      {children}
    </div>
  );
}

function Label({ children, required }) {
  return (
    <p style={{ margin:"0 0 5px", fontSize:11, fontWeight:700, color:C.gray[600],
      textTransform:"uppercase", letterSpacing:"0.07em" }}>
      {children}{required && <span style={{ color:C.red[600] }}> *</span>}
    </p>
  );
}

function Input({ value, onChange, placeholder, type="text" }) {
  return (
    <input type={type} value={value} onChange={e=>onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width:"100%", padding:"10px 13px", borderRadius:9, fontSize:13,
        border:`1px solid ${C.gray[100]}`, outline:"none", fontFamily:"inherit",
        background:"#fafafa", boxSizing:"border-box", color:"#1a1a2e" }} />
  );
}

function Textarea({ value, onChange, placeholder, rows=3 }) {
  return (
    <textarea value={value} onChange={e=>onChange(e.target.value)}
      placeholder={placeholder} rows={rows}
      style={{ width:"100%", padding:"10px 13px", borderRadius:9, fontSize:13,
        border:`1px solid ${C.gray[100]}`, outline:"none", fontFamily:"inherit",
        background:"#fafafa", boxSizing:"border-box", color:"#1a1a2e", resize:"vertical" }} />
  );
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

function CheckItem({ label, checked, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
      borderRadius:9, cursor:"pointer", fontSize:13, color:"#1a1a2e",
      background:checked?C.teal[50]:"transparent",
      border:`1px solid ${checked?C.teal[100]:"transparent"}`,
      marginBottom:4, transition:"all 0.12s" }}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}
        style={{ accentColor:C.teal[600], width:15, height:15 }} />
      {label}
    </label>
  );
}

function StatusBadge({ status }) {
  const m = {
    registered:        ["blue",   "Registered"],
    sent_to_doctor:    ["amber",  "With Doctor"],
    pending_payment:   ["amber",  "Awaiting Payment"],
    sent_to_lab:       ["purple", "In Lab"],
    lab_done:          ["teal",   "Lab Done"],
    diagnosed:         ["green",  "Diagnosed"],
    needs_appointment: ["amber",  "Needs Appt"],
    completed:         ["green",  "Completed"],
  };
  const [col, lbl] = m[status] || ["gray", status];
  return <Badge color={col}>{lbl}</Badge>;
}

function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign:"center", padding:"60px 24px" }}>
      <div style={{ fontSize:44, marginBottom:12 }}>{icon}</div>
      <p style={{ fontWeight:700, fontSize:15, color:C.gray[800], margin:"0 0 4px" }}>{title}</p>
      <p style={{ fontSize:13, color:C.gray[600], margin:0 }}>{sub}</p>
    </div>
  );
}

function TopBar({ role, tabs, activeTab, onTabChange, onLogout }) {
  const r = ROLES[role];
  return (
    <div style={{ background:"#fff", borderBottom:`1px solid ${C.gray[100]}`,
      padding:"0 24px", display:"flex", alignItems:"center", gap:12,
      height:58, position:"sticky", top:0, zIndex:99 }}>
      <span style={{ fontSize:22 }}>{r.icon}</span>
      <div style={{ flex:1 }}>
        <p style={{ margin:0, fontWeight:700, fontSize:14, color:"#1a1a2e" }}>Primary Clinic</p>
        <p style={{ margin:0, fontSize:11, fontWeight:700, color:r.color[600],
          textTransform:"uppercase", letterSpacing:"0.07em" }}>{r.label}</p>
      </div>
      <div style={{ display:"flex", gap:3 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={()=>onTabChange(t.key)} style={{
            padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:700,
            border:"none", cursor:"pointer", fontFamily:"inherit", transition:"all 0.12s",
            background: activeTab===t.key ? r.color[600] : "transparent",
            color: activeTab===t.key ? "#fff" : C.gray[600],
          }}>{t.label}</button>
        ))}
      </div>
      <button onClick={onLogout} style={{ background:C.red[50], color:C.red[800],
        border:`1px solid ${C.red[100]}`, padding:"7px 14px", borderRadius:8,
        fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
        Sign Out
      </button>
    </div>
  );
}

function Page({ children }) {
  return <div style={{ maxWidth:920, margin:"0 auto", padding:"28px 24px" }}>{children}</div>;
}

function H({ children, sub }) {
  return (
    <div style={{ marginBottom:22 }}>
      <h2 style={{ fontSize:19, fontWeight:700, color:"#1a1a2e", margin:0 }}>{children}</h2>
      {sub && <p style={{ fontSize:13, color:C.gray[600], margin:"4px 0 0" }}>{sub}</p>}
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [step, setStep]         = useState(null);
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [ownerView, setOwnerView] = useState("reception");

  function pickRole(key) { setStep(key); setEmail(""); setPassword(""); setError(""); }
  function handleBack()  { setStep(null); setEmail(""); setPassword(""); setError(""); }

  async function handleStaffLogin() {
    setError("");
    if (!email || !password) { setError("Please enter both email and password."); return; }
    const r = ROLES[step];
    if (email.trim().toLowerCase() !== r.email) {
      setError(`Incorrect email for ${r.label}. Please check and try again.`); return;
    }
    if (password !== r.password) { setError("Incorrect password. Please try again."); return; }
    setLoading(true);
    try {
      const token = await supabaseLogin(r.email, r.password);
      setToken(token); setRole(step); onLogin(step);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleOwnerLogin() {
    setError("");
    if (!password) { setError("Please enter the owner password."); return; }
    if (password !== OWNER_PASSWORD) { setError("Incorrect owner password."); return; }
    setLoading(true);
    try {
      const token = await supabaseLogin(OWNER_EMAIL, OWNER_PASSWORD);
      setToken(token); setRole("owner"); onLogin("owner", ownerView);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function handleKeyDown(e, fn) { if (e.key === "Enter") fn(); }

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      padding:24, fontFamily:"system-ui, sans-serif",
      background:"linear-gradient(135deg, #0a1628 0%, #0d2240 55%, #0b3326 100%)" }}>
      <div style={{ width:"100%", maxWidth:420 }}>
        <div style={{ textAlign:"center", marginBottom:32, position:"relative" }}>
          <button onClick={()=>pickRole("owner")} style={{
            position:"absolute", top:0, right:0,
            background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.13)",
            color:"rgba(255,255,255,0.45)", borderRadius:8, padding:"5px 12px",
            fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
            letterSpacing:"0.05em",
          }}>🔐 Owner</button>
          <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
            width:64, height:64, background:"rgba(255,255,255,0.08)", borderRadius:18,
            fontSize:30, marginBottom:12, border:"1px solid rgba(255,255,255,0.12)" }}>🏥</div>
          <h1 style={{ color:"#fff", fontSize:24, fontWeight:700, margin:"0 0 4px" }}>Primary Clinic</h1>
          <p style={{ color:"rgba(255,255,255,0.45)", fontSize:13, margin:0 }}>Staff Management System</p>
        </div>

        {!step && (
          <Card style={{ padding:28 }}>
            <p style={{ fontSize:12, fontWeight:700, color:C.gray[600], textTransform:"uppercase",
              letterSpacing:"0.07em", textAlign:"center", marginBottom:18 }}>Who are you?</p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {Object.entries(ROLES).map(([key, r]) => (
                <button key={key} onClick={()=>pickRole(key)} style={{
                  display:"flex", alignItems:"center", gap:14, padding:"15px 18px",
                  borderRadius:12, border:`1px solid ${r.color[100]}`, background:r.color[50],
                  cursor:"pointer", fontFamily:"inherit", textAlign:"left",
                }}>
                  <span style={{ fontSize:26 }}>{r.icon}</span>
                  <div>
                    <p style={{ margin:0, fontWeight:700, fontSize:14, color:r.color[800] }}>{r.label}</p>
                    <p style={{ margin:0, fontSize:12, color:r.color[600] }}>Tap to sign in</p>
                  </div>
                  <span style={{ marginLeft:"auto", color:r.color[400], fontSize:16 }}>→</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {step && step !== "owner" && (
          <Card style={{ padding:28 }}>
            <button onClick={handleBack} style={{ background:"none", border:"none", cursor:"pointer",
              color:C.teal[600], fontSize:13, fontWeight:700, padding:0, marginBottom:22, fontFamily:"inherit" }}>
              ← Back
            </button>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:26,
              padding:"14px 16px", background:ROLES[step].color[50],
              border:`1px solid ${ROLES[step].color[100]}`, borderRadius:12 }}>
              <span style={{ fontSize:28 }}>{ROLES[step].icon}</span>
              <div>
                <p style={{ margin:0, fontWeight:700, fontSize:16, color:ROLES[step].color[800] }}>{ROLES[step].label}</p>
                <p style={{ margin:0, fontSize:12, color:ROLES[step].color[600] }}>Enter your email and password</p>
              </div>
            </div>
            {error && (
              <div style={{ background:C.red[50], border:`1px solid ${C.red[100]}`, borderRadius:9,
                padding:"10px 14px", marginBottom:16, fontSize:13, color:C.red[800], fontWeight:600 }}>
                ⚠ {error}
              </div>
            )}
            <Field label="Email" required>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="Enter your email" autoFocus autoComplete="off"
                name="clinic-email-no-autofill"
                style={{ width:"100%", padding:"10px 13px", borderRadius:9, fontSize:13,
                  border:`1px solid ${C.gray[100]}`, outline:"none", fontFamily:"inherit",
                  background:"#fafafa", boxSizing:"border-box", color:"#1a1a2e" }} />
            </Field>
            <Field label="Password" required>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                onKeyDown={e=>handleKeyDown(e, handleStaffLogin)}
                placeholder="Enter your password" autoComplete="new-password"
                name="clinic-password-no-autofill"
                style={{ width:"100%", padding:"10px 13px", borderRadius:9, fontSize:13,
                  border:`1px solid ${C.gray[100]}`, outline:"none", fontFamily:"inherit",
                  background:"#fafafa", boxSizing:"border-box", color:"#1a1a2e" }} />
            </Field>
            <Btn onClick={handleStaffLogin} disabled={loading || !email || !password} full variant="teal">
              {loading ? "Signing in…" : `Sign in as ${ROLES[step].label}`}
            </Btn>
          </Card>
        )}

        {step === "owner" && (
          <Card style={{ padding:28 }}>
            <button onClick={handleBack} style={{ background:"none", border:"none", cursor:"pointer",
              color:C.gray[600], fontSize:13, fontWeight:700, padding:0, marginBottom:22, fontFamily:"inherit" }}>
              ← Back
            </button>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24,
              padding:"14px 16px", background:"#1a1a2e", borderRadius:12 }}>
              <span style={{ fontSize:28 }}>🔐</span>
              <div>
                <p style={{ margin:0, fontWeight:700, fontSize:16, color:"#fff" }}>Owner Access</p>
                <p style={{ margin:0, fontSize:12, color:"rgba(255,255,255,0.5)" }}>Enter owner password</p>
              </div>
            </div>
            {error && (
              <div style={{ background:C.red[50], border:`1px solid ${C.red[100]}`, borderRadius:9,
                padding:"10px 14px", marginBottom:16, fontSize:13, color:C.red[800], fontWeight:600 }}>
                ⚠ {error}
              </div>
            )}
            <Field label="Password" required>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                onKeyDown={e=>handleKeyDown(e, handleOwnerLogin)}
                placeholder="Owner password" autoFocus autoComplete="new-password"
                style={{ width:"100%", padding:"10px 13px", borderRadius:9, fontSize:13,
                  border:`1px solid ${C.gray[100]}`, outline:"none", fontFamily:"inherit",
                  background:"#fafafa", boxSizing:"border-box", color:"#1a1a2e" }} />
            </Field>
            <p style={{ fontSize:11, color:C.gray[600], margin:"0 0 14px", fontWeight:600,
              textTransform:"uppercase", letterSpacing:"0.06em" }}>View as</p>
            <div style={{ display:"flex", gap:8, marginBottom:18 }}>
              {Object.entries(ROLES).map(([key, r]) => (
                <button key={key} onClick={()=>setOwnerView(key)} style={{
                  flex:1, padding:"10px 6px", borderRadius:9,
                  border:`1px solid ${ownerView===key ? r.color[400] : C.gray[100]}`,
                  background: ownerView===key ? r.color[50] : "#fafafa",
                  cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700,
                  color: ownerView===key ? r.color[800] : C.gray[600],
                }}>
                  {r.icon}<br/><span style={{ fontSize:10 }}>{r.label}</span>
                </button>
              ))}
            </div>
            <Btn onClick={handleOwnerLogin} disabled={loading || !password} full variant="teal">
              {loading ? "Entering…" : "🔐 Enter as Owner"}
            </Btn>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── persist helper ────────────────────────────────────────────────────────────
async function persistUpdate(patient, metaUpdates) {
  const newMeta = {
    clinicStatus:    patient.status,
    age:             patient.age,
    bp:              patient.bp,
    doctorNotes:     patient.doctorNotes,
    labResults:      patient.labResults,
    labNotes:        patient.labNotes,
    diagnosis:       patient.diagnosis,
    appointmentDate: patient.appointmentDate,
    ...metaUpdates,
  };
  const { error } = await supabase
    .from("patients")
    .update({ notes: JSON.stringify(newMeta) })
    .eq("id", patient.id);
  if (error) throw new Error(error.message);
}

// ── RECEPTION ─────────────────────────────────────────────────────────────────
function Reception({ onLogout, isOwner }) {
  const [patients, update] = useStore();
  const [tab, setTab]      = useState("new");
  const [form, setForm]    = useState({ name:"", age:"", phone:"", address:"", bp:"" });
  const [ok, setOk]        = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]  = useState("");

  const all             = patients;
  const appts           = patients.filter(p => p.status === "needs_appointment");
  const awaitingPayment = patients.filter(p => p.status === "pending_payment");

  const tabs = [
    { key:"new",     label:"New Patient" },
    { key:"payment", label:`Payments (${awaitingPayment.length})` },
    { key:"all",     label:`All Patients (${all.length})` },
    { key:"appts",   label:`Appointments (${appts.length})` },
  ];

  async function submit() {
    if (!form.name || !form.age || !form.phone) return;
    setSaving(true); setError("");
    try {
      const raw = await createPatient(form);
      const display = toDisplay(raw);
      update(ps => [display, ...ps]);
      setOk(true);
      setTimeout(() => { setOk(false); setForm({ name:"", age:"", phone:"", address:"", bp:"" }); }, 2200);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function markPaid(patient) {
    try {
      await persistUpdate(patient, { clinicStatus: "sent_to_lab" });
      update(ps => ps.map(p => p.id===patient.id ? { ...p, status:"sent_to_lab" } : p));
    } catch (e) { alert("Error: " + e.message); }
  }

  async function scheduleAppt(patient, date) {
    try {
      await persistUpdate(patient, { clinicStatus:"completed", appointmentDate:date });
      update(ps => ps.map(p => p.id===patient.id ? { ...p, status:"completed", appointmentDate:date } : p));
    } catch (e) { alert("Error: " + e.message); }
  }

  return (
    <div style={{ minHeight: isOwner ? "auto" : "100vh", background:C.gray[50], fontFamily:"system-ui, sans-serif" }}>
      {!isOwner && <TopBar role="reception" tabs={tabs} activeTab={tab} onTabChange={setTab} onLogout={onLogout} />}
      {isOwner && (
        <div style={{ background:"#fff", borderBottom:`1px solid ${C.gray[100]}`, padding:"10px 24px", display:"flex", gap:6 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={()=>setTab(t.key)} style={{
              padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:700, border:"none",
              cursor:"pointer", fontFamily:"inherit",
              background: tab===t.key ? C.blue[600] : "transparent",
              color: tab===t.key ? "#fff" : C.gray[600],
            }}>{t.label}</button>
          ))}
        </div>
      )}
      <Page>
        {tab === "new" && (
          <>
            <H sub="Fill in patient details and send to the doctor">Register New Patient</H>
            <Card style={{ padding:28, maxWidth:580 }}>
              {ok && (
                <div style={{ background:C.green[50], border:`1px solid ${C.green[100]}`, borderRadius:10,
                  padding:"12px 16px", marginBottom:20, fontSize:13, color:C.green[800], fontWeight:700 }}>
                  ✅ Patient registered and sent to doctor successfully!
                </div>
              )}
              {error && (
                <div style={{ background:C.red[50], border:`1px solid ${C.red[100]}`, borderRadius:10,
                  padding:"12px 16px", marginBottom:20, fontSize:13, color:C.red[800], fontWeight:700 }}>
                  ⚠ {error}
                </div>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
                <div style={{ gridColumn:"1/-1" }}>
                  <Field label="Full Name" required>
                    <Input value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="e.g. Amara Tadesse" />
                  </Field>
                </div>
                <Field label="Age" required>
                  <Input value={form.age} onChange={v=>setForm(f=>({...f,age:v}))} placeholder="e.g. 34" />
                </Field>
                <Field label="Phone" required>
                  <Input value={form.phone} onChange={v=>setForm(f=>({...f,phone:v}))} placeholder="e.g. 0911-123-456" />
                </Field>
                <div style={{ gridColumn:"1/-1" }}>
                  <Field label="Address">
                    <Input value={form.address} onChange={v=>setForm(f=>({...f,address:v}))} placeholder="e.g. Hawassa, Tabor" />
                  </Field>
                </div>
                <div style={{ gridColumn:"1/-1" }}>
                  <Field label="Blood Pressure">
                    <Input value={form.bp} onChange={v=>setForm(f=>({...f,bp:v}))} placeholder="e.g. 120/80 mmHg" />
                  </Field>
                </div>
              </div>
              <Btn onClick={submit} disabled={!form.name||!form.age||!form.phone||saving} variant="blue" full>
                {saving ? "Saving…" : "📤 Send to Doctor"}
              </Btn>
            </Card>
          </>
        )}

        {tab === "payment" && (
          <>
            <H sub="Patients the doctor has seen — collect payment then send to lab">Awaiting Payment</H>
            {awaitingPayment.length === 0
              ? <Card><Empty icon="💳" title="No pending payments" sub="Patients sent back by the doctor will appear here" /></Card>
              : awaitingPayment.map(p => (
                <Card key={p.id} style={{ marginBottom:10, padding:"18px 20px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                    <div style={{ flex:1 }}>
                      <p style={{ margin:"0 0 3px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                      <p style={{ margin:"0 0 6px", fontSize:12, color:C.gray[600] }}>Age {p.age} · {p.phone}</p>
                      {p.doctorNotes?.suspectedDisease && (
                        <p style={{ margin:0, fontSize:13, color:C.teal[800] }}>Suspected: {p.doctorNotes.suspectedDisease}</p>
                      )}
                      {p.doctorNotes?.tests?.length > 0 && (
                        <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:5 }}>
                          <span style={{ fontSize:12, color:C.gray[600], marginRight:2 }}>Lab tests ordered:</span>
                          {p.doctorNotes.tests.map(t => <Badge key={t} color="purple">{t}</Badge>)}
                        </div>
                      )}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                      <StatusBadge status={p.status} />
                      <Btn onClick={()=>markPaid(p)} variant="blue">💳 Paid — Send to Lab</Btn>
                    </div>
                  </div>
                </Card>
              ))
            }
          </>
        )}

        {tab === "all" && (
          <>
            <H sub="All registered patients and their current status">Patient Registry</H>
            {all.length === 0
              ? <Card><Empty icon="👥" title="No patients yet" sub="Register a new patient using the form" /></Card>
              : all.map(p => (
                <Card key={p.id} style={{ marginBottom:10, padding:"16px 20px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                    <div>
                      <p style={{ margin:"0 0 3px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                      <p style={{ margin:0, fontSize:12, color:C.gray[600] }}>Age {p.age} · {p.phone} · BP: {p.bp||"N/A"}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.diagnosis && (
                    <div style={{ marginTop:10, padding:"9px 13px", background:C.green[50], borderRadius:8, fontSize:13, color:C.green[800] }}>
                      <strong>Diagnosis:</strong> {p.diagnosis}
                    </div>
                  )}
                  {p.appointmentDate && (
                    <div style={{ marginTop:8, padding:"9px 13px", background:C.blue[50], borderRadius:8, fontSize:13, color:C.blue[800] }}>
                      <strong>Appointment:</strong> {p.appointmentDate}
                    </div>
                  )}
                </Card>
              ))
            }
          </>
        )}

        {tab === "appts" && (
          <>
            <H sub="Patients the doctor flagged for follow-up appointments">Appointment Requests</H>
            {appts.length === 0
              ? <Card><Empty icon="📅" title="No appointment requests" sub="The doctor will flag patients who need follow-up" /></Card>
              : appts.map(p => <ApptCard key={p.id} patient={p} onSchedule={scheduleAppt} />)
            }
          </>
        )}
      </Page>
    </div>
  );
}

function ApptCard({ patient, onSchedule }) {
  const [date, setDate] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSchedule() {
    if (!date) return;
    setSaving(true);
    try { await onSchedule(patient, date); setDone(true); }
    finally { setSaving(false); }
  }

  return (
    <Card style={{ marginBottom:12, padding:"18px 20px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <p style={{ margin:"0 0 3px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{patient.name}</p>
          <p style={{ margin:"0 0 6px", fontSize:12, color:C.gray[600] }}>Age {patient.age} · {patient.phone}</p>
          {patient.diagnosis && <p style={{ margin:0, fontSize:13, color:C.teal[800] }}>Dx: {patient.diagnosis}</p>}
        </div>
        <Badge color="amber">Needs Appointment</Badge>
      </div>
      {done
        ? <div style={{ marginTop:12, padding:"10px 14px", background:C.green[50], borderRadius:9, fontSize:13, color:C.green[800], fontWeight:700 }}>✅ Appointment set for {date}</div>
        : <div style={{ marginTop:14, display:"flex", gap:10, alignItems:"center" }}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              style={{ padding:"9px 12px", borderRadius:8, border:`1px solid ${C.gray[100]}`, fontSize:13, fontFamily:"inherit", flex:1 }} />
            <Btn onClick={handleSchedule} disabled={!date||saving} variant="blue">
              {saving ? "Saving…" : "📅 Schedule"}
            </Btn>
          </div>
      }
    </Card>
  );
}

// ── DOCTOR ────────────────────────────────────────────────────────────────────
function Doctor({ onLogout, isOwner }) {
  const [patients, update] = useStore();
  const [tab, setTab]      = useState("queue");
  const [queueSelectedId, setQueueSelectedId] = useState(null);
  const [labSelectedId,   setLabSelectedId]   = useState(null);

  const queueSelected = queueSelectedId ? patients.find(p => p.id === queueSelectedId) || null : null;
  const labSelected   = labSelectedId   ? patients.find(p => p.id === labSelectedId)   || null : null;

  const queue   = patients.filter(p => p.status === "registered" || p.status === "sent_to_doctor");
  const labDone = patients.filter(p => p.status === "lab_done");
  const history = patients.filter(p => ["pending_payment","diagnosed","needs_appointment","completed"].includes(p.status));

  const tabs = [
    { key:"queue",   label:`Patient Queue (${queue.length})` },
    { key:"lab",     label:`Lab Reports (${labDone.length})` },
    { key:"history", label:`History (${history.length})` },
  ];

  async function saveConsult(updated) {
    try {
      await persistUpdate(updated, { clinicStatus: "pending_payment", doctorNotes: updated.doctorNotes });
      update(ps => ps.map(p => p.id===updated.id ? updated : p));
      setQueueSelectedId(null);
    } catch (e) { alert("Error saving: " + e.message); }
  }

  async function saveDiagnosis(updated) {
    try {
      await persistUpdate(updated, { clinicStatus: updated.status, diagnosis: updated.diagnosis });
      update(ps => ps.map(p => p.id===updated.id ? updated : p));
      setLabSelectedId(null);
    } catch (e) { alert("Error saving: " + e.message); }
  }

  return (
    <div style={{ minHeight: isOwner ? "auto" : "100vh", background:C.gray[50], fontFamily:"system-ui, sans-serif" }}>
      {!isOwner && <TopBar role="doctor" tabs={tabs} activeTab={tab}
        onTabChange={t=>{ setTab(t); setQueueSelectedId(null); setLabSelectedId(null); }} onLogout={onLogout} />}
      {isOwner && (
        <div style={{ background:"#fff", borderBottom:`1px solid ${C.gray[100]}`, padding:"10px 24px", display:"flex", gap:6 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={()=>{ setTab(t.key); setQueueSelectedId(null); setLabSelectedId(null); }} style={{
              padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:700, border:"none",
              cursor:"pointer", fontFamily:"inherit",
              background: tab===t.key ? C.teal[600] : "transparent",
              color: tab===t.key ? "#fff" : C.gray[600],
            }}>{t.label}</button>
          ))}
        </div>
      )}
      <Page>
        {tab === "queue" && (
          <>
            {queueSelected ? (
              <Consult patient={queueSelected} onDone={saveConsult} onBack={()=>setQueueSelectedId(null)} />
            ) : (
              <>
                <H sub="Click a patient card to open their details">Incoming Patients</H>
                {queue.length === 0
                  ? <Card><Empty icon="🩺" title="No patients in queue" sub="Reception will send patients here" /></Card>
                  : queue.map(p => (
                    <Card key={p.id} style={{ marginBottom:10, padding:"16px 20px" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                        <div style={{ flex:1 }}>
                          <p style={{ margin:"0 0 4px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                          <p style={{ margin:0, fontSize:13, color:C.gray[600] }}>Age {p.age} · Phone: {p.phone} · BP: {p.bp||"Not recorded"}</p>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                          <StatusBadge status={p.status} />
                          <Btn onClick={()=>setQueueSelectedId(p.id)} variant="teal">Open Patient →</Btn>
                        </div>
                      </div>
                    </Card>
                  ))
                }
              </>
            )}
          </>
        )}

        {tab === "lab" && (
          <>
            {labSelected ? (
              <Diagnose patient={labSelected} onDone={saveDiagnosis} onBack={()=>setLabSelectedId(null)} />
            ) : (
              <>
                <H sub="Open a patient to review their lab results and write a final diagnosis">Lab Reports Ready</H>
                {labDone.length === 0
                  ? <Card><Empty icon="🔬" title="No lab reports yet" sub="Lab assistant will send results here" /></Card>
                  : labDone.map(p => (
                    <Card key={p.id} style={{ marginBottom:10, padding:"16px 20px" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                        <div style={{ flex:1 }}>
                          <p style={{ margin:"0 0 4px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                          <p style={{ margin:0, fontSize:13, color:C.gray[600] }}>Lab results are ready for review</p>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                          <Badge color="teal">Lab Ready</Badge>
                          <Btn onClick={()=>setLabSelectedId(p.id)} variant="teal">View Results →</Btn>
                        </div>
                      </div>
                    </Card>
                  ))
                }
              </>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            <H sub="Patients you have already diagnosed">Diagnosis History</H>
            {history.length === 0
              ? <Card><Empty icon="📋" title="No history yet" sub="Completed diagnoses appear here" /></Card>
              : history.map(p => (
                <Card key={p.id} style={{ marginBottom:10, padding:"16px 20px" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
                    <div>
                      <p style={{ margin:"0 0 3px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                      <p style={{ margin:"0 0 8px", fontSize:12, color:C.gray[600] }}>Age {p.age} · {p.phone}</p>
                      {p.diagnosis && <p style={{ margin:0, fontSize:13, color:C.teal[800] }}><b>Dx:</b> {p.diagnosis}</p>}
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                </Card>
              ))
            }
          </>
        )}
      </Page>
    </div>
  );
}

function Consult({ patient, onDone, onBack }) {
  const [symptoms,         setSymptoms]         = useState("");
  const [suspectedDisease, setSuspectedDisease] = useState("");
  const [notes,            setNotes]            = useState("");
  const [tests,            setTests]            = useState([]);
  const [saving,           setSaving]           = useState(false);

  function toggleTest(t) { setTests(ts => ts.includes(t) ? ts.filter(x=>x!==t) : [...ts, t]); }

  async function send() {
    setSaving(true);
    const updated = { ...patient, status:"pending_payment",
      doctorNotes:{ symptoms, suspectedDisease, notes, tests, sentAt:new Date() } };
    await onDone(updated);
    setSaving(false);
  }

  return (
    <div>
      <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
        color:C.teal[600], fontSize:13, fontWeight:700, padding:0, marginBottom:20, fontFamily:"inherit" }}>
        ← Back to queue
      </button>
      <Card style={{ padding:22, marginBottom:16, background:C.teal[50], border:`1px solid ${C.teal[100]}` }}>
        <p style={{ margin:"0 0 14px", fontWeight:700, fontSize:14, color:C.teal[800] }}>👤 Patient Vitals — sent by Reception</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10 }}>
          {[["Full Name",patient.name],["Age",patient.age?patient.age+" yrs":"—"],
            ["Phone",patient.phone],["Address",patient.address||"—"],["Blood Pressure",patient.bp||"Not recorded"],
          ].map(([lbl,val])=>(
            <div key={lbl} style={{ background:"#fff", borderRadius:10, padding:"10px 14px", border:`1px solid ${C.teal[100]}` }}>
              <p style={{ margin:"0 0 3px", fontSize:10, fontWeight:700, color:C.teal[600], textTransform:"uppercase", letterSpacing:"0.07em" }}>{lbl}</p>
              <p style={{ margin:0, fontSize:13, fontWeight:600, color:"#1a1a2e" }}>{val}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card style={{ padding:22, marginBottom:16 }}>
        <p style={{ margin:"0 0 16px", fontWeight:700, fontSize:14, color:"#1a1a2e" }}>🩺 Clinical Assessment</p>
        <Field label="Patient Symptoms" required>
          <Textarea value={symptoms} onChange={setSymptoms}
            placeholder="Describe what the patient reports — fever, pain, cough, nausea, fatigue, duration..." rows={4} />
        </Field>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <Field label="Suspected Disease">
            <Input value={suspectedDisease} onChange={setSuspectedDisease} placeholder="e.g. Malaria, Typhoid, UTI..." />
          </Field>
          <Field label="Additional Notes">
            <Input value={notes} onChange={setNotes} placeholder="Any observations..." />
          </Field>
        </div>
      </Card>
      <Card style={{ padding:22, marginBottom:22 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <p style={{ margin:0, fontWeight:700, fontSize:14, color:"#1a1a2e" }}>
            🔬 Order Lab Tests <span style={{ fontSize:12, fontWeight:400, color:C.gray[600], marginLeft:6 }}>(optional)</span>
          </p>
          {tests.length > 0 && (
            <span style={{ background:C.purple[50], color:C.purple[800], border:`1px solid ${C.purple[100]}`,
              borderRadius:20, padding:"3px 12px", fontSize:12, fontWeight:700 }}>{tests.length} selected</span>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:2 }}>
          {LAB_TESTS.map(t => <CheckItem key={t} label={t} checked={tests.includes(t)} onChange={()=>toggleTest(t)} />)}
        </div>
      </Card>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <Btn onClick={onBack} variant="ghost">Cancel</Btn>
        {!symptoms && <span style={{ fontSize:12, color:C.amber[600] }}>⚠ Fill in symptoms before sending</span>}
        <Btn onClick={send} disabled={!symptoms||saving} variant="blue">
          {saving ? "Saving…" : tests.length > 0
            ? `💳 Done — Send to Reception for Payment (${tests.length} lab test${tests.length>1?"s":""})`
            : "💳 Done — Send to Reception for Payment"}
        </Btn>
      </div>
    </div>
  );
}

function Diagnose({ patient, onDone, onBack }) {
  const [diagnosis, setDiagnosis] = useState("");
  const [needsAppt, setNeedsAppt] = useState(false);
  const [saving,    setSaving]    = useState(false);

  async function finish() {
    setSaving(true);
    const updated = { ...patient, diagnosis, status: needsAppt ? "needs_appointment" : "diagnosed" };
    await onDone(updated);
    setSaving(false);
  }

  return (
    <div>
      <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
        color:C.teal[600], fontSize:13, fontWeight:700, padding:0, marginBottom:20, fontFamily:"inherit" }}>
        ← Back to lab reports
      </button>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <Card style={{ padding:20 }}>
          <p style={{ margin:"0 0 14px", fontWeight:700, fontSize:14, color:"#1a1a2e" }}>👤 Patient</p>
          {[["Name",patient.name],["Age",patient.age],["Phone",patient.phone],
            ["Symptoms",patient.doctorNotes?.symptoms],["Suspected",patient.doctorNotes?.suspectedDisease||"—"],
          ].map(([l,v])=>(
            <div key={l} style={{ marginBottom:8 }}>
              <span style={{ fontSize:10, fontWeight:700, color:C.gray[400], textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</span>
              <p style={{ margin:"2px 0 0", fontSize:13, color:"#1a1a2e", fontWeight:500 }}>{v||"—"}</p>
            </div>
          ))}
        </Card>
        <Card style={{ padding:20 }}>
          <p style={{ margin:"0 0 14px", fontWeight:700, fontSize:14, color:C.purple[800] }}>🔬 Lab Results</p>
          {patient.labResults && Object.keys(patient.labResults).length > 0
            ? Object.entries(patient.labResults).map(([test, result]) => (
              <div key={test} style={{ marginBottom:12, paddingBottom:10, borderBottom:`1px solid ${C.gray[50]}` }}>
                <p style={{ margin:"0 0 2px", fontSize:11, fontWeight:700, color:C.purple[600], textTransform:"uppercase", letterSpacing:"0.06em" }}>{test}</p>
                <p style={{ margin:0, fontSize:13, color:"#1a1a2e" }}>{result}</p>
              </div>
            ))
            : <p style={{ fontSize:13, color:C.gray[400] }}>No tests were ordered</p>
          }
          {patient.labNotes && (
            <div style={{ marginTop:10, padding:"9px 12px", background:C.purple[50], borderRadius:8, fontSize:13, color:C.purple[800] }}>
              <b>Lab notes:</b> {patient.labNotes}
            </div>
          )}
        </Card>
      </div>
      <Card style={{ padding:22, marginBottom:20 }}>
        <p style={{ margin:"0 0 14px", fontWeight:700, fontSize:14, color:"#1a1a2e" }}>✍ Final Diagnosis</p>
        <Field label="Diagnosis & Treatment Plan" required>
          <Textarea value={diagnosis} onChange={setDiagnosis}
            placeholder="Write your final diagnosis and the recommended treatment plan..." rows={5} />
        </Field>
        <CheckItem label="This patient needs a follow-up appointment" checked={needsAppt} onChange={setNeedsAppt} />
      </Card>
      <div style={{ display:"flex", gap:12 }}>
        <Btn onClick={onBack} variant="ghost">Cancel</Btn>
        <Btn onClick={finish} disabled={!diagnosis||saving} variant="teal">
          {saving ? "Saving…" : needsAppt ? "📅 Done — Request Appointment" : "✅ Done — No Appointment Needed"}
        </Btn>
      </div>
    </div>
  );
}

// ── LAB ───────────────────────────────────────────────────────────────────────
function Lab({ onLogout, isOwner }) {
  const [patients, update] = useStore();
  const [tab, setTab]      = useState("queue");
  const [selectedId, setSelectedId] = useState(null);

  const queue = patients.filter(p => p.status === "sent_to_lab");
  const done  = patients.filter(p => ["lab_done","diagnosed","needs_appointment","completed"].includes(p.status));
  const selected = selectedId ? patients.find(p => p.id === selectedId) || null : null;

  const tabs = [
    { key:"queue", label:`Test Queue (${queue.length})` },
    { key:"done",  label:`Completed (${done.length})` },
  ];

  async function saveResults(updated) {
    try {
      await persistUpdate(updated, { clinicStatus: "lab_done", labResults: updated.labResults, labNotes: updated.labNotes });
      update(ps => ps.map(p => p.id===updated.id ? updated : p));
      setSelectedId(null);
    } catch (e) { alert("Error saving: " + e.message); }
  }

  return (
    <div style={{ minHeight: isOwner ? "auto" : "100vh", background:C.gray[50], fontFamily:"system-ui, sans-serif" }}>
      {!isOwner && <TopBar role="lab" tabs={tabs} activeTab={tab}
        onTabChange={t=>{ setTab(t); setSelectedId(null); }} onLogout={onLogout} />}
      {isOwner && (
        <div style={{ background:"#fff", borderBottom:`1px solid ${C.gray[100]}`, padding:"10px 24px", display:"flex", gap:6 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={()=>{ setTab(t.key); setSelectedId(null); }} style={{
              padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:700, border:"none",
              cursor:"pointer", fontFamily:"inherit",
              background: tab===t.key ? C.purple[600] : "transparent",
              color: tab===t.key ? "#fff" : C.gray[600],
            }}>{t.label}</button>
          ))}
        </div>
      )}
      <Page>
        {tab === "queue" && (
          <>
            {selected ? (
              <LabForm patient={selected} onDone={saveResults} onBack={()=>setSelectedId(null)} />
            ) : (
              <>
                <H sub="Open a patient to enter their test results">Tests Ordered by Doctor</H>
                {queue.length === 0
                  ? <Card><Empty icon="🔬" title="No tests in queue" sub="The doctor will send lab orders here" /></Card>
                  : queue.map(p => (
                    <Card key={p.id} style={{ marginBottom:10, padding:"16px 20px" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                        <div style={{ flex:1 }}>
                          <p style={{ margin:"0 0 4px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                          <p style={{ margin:0, fontSize:13, color:C.gray[600] }}>
                            {p.doctorNotes?.tests?.length||0} test{p.doctorNotes?.tests?.length===1?"":"s"} ordered
                          </p>
                          {p.doctorNotes?.tests?.length > 0 && (
                            <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:6 }}>
                              {p.doctorNotes.tests.map(t=><Badge key={t} color="gray">{t}</Badge>)}
                            </div>
                          )}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                          <Badge color="purple">Pending</Badge>
                          <Btn onClick={()=>setSelectedId(p.id)} variant="purple">Enter Results →</Btn>
                        </div>
                      </div>
                    </Card>
                  ))
                }
              </>
            )}
          </>
        )}
        {tab === "done" && (
          <>
            <H sub="Results already sent back to the doctor">Completed Tests</H>
            {done.length === 0
              ? <Card><Empty icon="✅" title="No completed tests yet" sub="Process tests from the queue" /></Card>
              : done.map(p => (
                <Card key={p.id} style={{ marginBottom:10, padding:"16px 20px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div>
                      <p style={{ margin:"0 0 3px", fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{p.name}</p>
                      <p style={{ margin:0, fontSize:12, color:C.gray[600] }}>Results sent to doctor</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                </Card>
              ))
            }
          </>
        )}
      </Page>
    </div>
  );
}

function LabForm({ patient, onDone, onBack }) {
  const tests = patient.doctorNotes?.tests || [];
  const [results,     setResults]     = useState(Object.fromEntries(tests.map(t=>[t,""])));
  const [extra,       setExtra]       = useState(false);
  const [extraName,   setExtraName]   = useState("");
  const [extraResult, setExtraResult] = useState("");
  const [notes,       setNotes]       = useState("");
  const [saving,      setSaving]      = useState(false);

  async function send() {
    setSaving(true);
    const all = { ...results };
    if (extra && extraName) all[extraName] = extraResult;
    const updated = { ...patient, status:"lab_done", labResults:all, labNotes:notes };
    await onDone(updated);
    setSaving(false);
  }

  const canSend = (tests.length === 0 || tests.every(t=>results[t]?.trim())) &&
    (!extra || !extraName || extraResult.trim());

  return (
    <div>
      <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
        color:C.purple[600], fontSize:13, fontWeight:700, padding:0, marginBottom:20, fontFamily:"inherit" }}>
        ← Back to queue
      </button>
      <Card style={{ padding:20, marginBottom:14, background:C.purple[50], border:`1px solid ${C.purple[100]}` }}>
        <p style={{ margin:"0 0 12px", fontWeight:700, fontSize:14, color:C.purple[800] }}>👤 Patient Info</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10 }}>
          {[["Name",patient.name],["Age",patient.age],["Symptoms",patient.doctorNotes?.symptoms],
            ["Suspected",patient.doctorNotes?.suspectedDisease||"—"]].map(([l,v])=>(
            <div key={l} style={{ background:"#fff", borderRadius:9, padding:"9px 13px", border:`1px solid ${C.purple[100]}` }}>
              <p style={{ margin:"0 0 2px", fontSize:10, fontWeight:700, color:C.purple[600], textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</p>
              <p style={{ margin:0, fontSize:13, fontWeight:600, color:"#1a1a2e" }}>{v||"—"}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card style={{ padding:22, marginBottom:16 }}>
        <p style={{ margin:"0 0 16px", fontWeight:700, fontSize:14, color:"#1a1a2e" }}>🧪 Enter Test Results</p>
        {tests.length === 0 && (
          <div style={{ padding:"12px 14px", background:C.amber[50], borderRadius:9, fontSize:13, color:C.amber[800], marginBottom:14 }}>
            No specific tests were ordered. You can add your own tests below.
          </div>
        )}
        {tests.map(t => (
          <Field key={t} label={t} required>
            <Textarea value={results[t]} onChange={v=>setResults(r=>({...r,[t]:v}))}
              placeholder={`Enter result for ${t}...`} rows={2} />
          </Field>
        ))}
        <div style={{ marginTop:14, padding:"14px 16px", border:`2px dashed ${C.purple[100]}`, borderRadius:10 }}>
          <CheckItem label="I performed additional tests not ordered by the doctor" checked={extra} onChange={setExtra} />
          {extra && (
            <div style={{ marginTop:12 }}>
              <Field label="Test Name">
                <Input value={extraName} onChange={setExtraName} placeholder="e.g. Sputum Culture, ECG..." />
              </Field>
              <Field label="Result">
                <Textarea value={extraResult} onChange={setExtraResult} placeholder="Enter the result..." rows={2} />
              </Field>
            </div>
          )}
        </div>
        <div style={{ marginTop:14 }}>
          <Field label="Lab Notes (optional)">
            <Textarea value={notes} onChange={setNotes} placeholder="Any additional observations..." rows={2} />
          </Field>
        </div>
      </Card>
      <div style={{ display:"flex", gap:12 }}>
        <Btn onClick={onBack} variant="ghost">Cancel</Btn>
        <Btn onClick={send} disabled={!canSend||saving} variant="purple">
          {saving ? "Saving…" : "📤 Send Results to Doctor"}
        </Btn>
      </div>
    </div>
  );
}

// ── OWNER ─────────────────────────────────────────────────────────────────────
function OwnerTopBar({ activeView, onViewChange, onLogout }) {
  return (
    <div style={{ background:"#1a1a2e", borderBottom:"2px solid #2d2d4e",
      padding:"0 24px", display:"flex", alignItems:"center", gap:12,
      height:58, position:"sticky", top:0, zIndex:99 }}>
      <span style={{ fontSize:22 }}>🔐</span>
      <div style={{ flex:1 }}>
        <p style={{ margin:0, fontWeight:700, fontSize:14, color:"#fff" }}>Primary Clinic</p>
        <p style={{ margin:0, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.4)",
          textTransform:"uppercase", letterSpacing:"0.07em" }}>Owner View</p>
      </div>
      <div style={{ display:"flex", gap:3 }}>
        {Object.entries(ROLES).map(([key, r]) => (
          <button key={key} onClick={()=>onViewChange(key)} style={{
            padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:700,
            border:"none", cursor:"pointer", fontFamily:"inherit",
            background: activeView===key ? r.color[600] : "rgba(255,255,255,0.08)",
            color: activeView===key ? "#fff" : "rgba(255,255,255,0.5)",
          }}>{r.icon} {r.label}</button>
        ))}
      </div>
      <button onClick={onLogout} style={{ background:"rgba(226,75,74,0.15)", color:"#f7c1c1",
        border:"1px solid rgba(226,75,74,0.3)", padding:"7px 14px", borderRadius:8,
        fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
        Sign Out
      </button>
    </div>
  );
}

function OwnerShell({ onLogout }) {
  const [view, setView] = useState("reception");
  function ownerLogout() { clearToken(); clearRole(); _patients = []; _loaded = false; onLogout(); }
  return (
    <div style={{ minHeight:"100vh", background:C.gray[50], fontFamily:"system-ui, sans-serif" }}>
      <OwnerTopBar activeView={view} onViewChange={setView} onLogout={ownerLogout} />
      {view === "reception" && <Reception onLogout={ownerLogout} isOwner />}
      {view === "doctor"    && <Doctor    onLogout={ownerLogout} isOwner />}
      {view === "lab"       && <Lab       onLogout={ownerLogout} isOwner />}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [role, setRole] = useState(null);

  useEffect(() => { clearToken(); clearRole(); }, []);

  function handleLogin(r, view) { setRole(r); }

  function handleLogout() {
    clearToken(); clearRole();
    _patients = []; _loaded = false;
    setRole(null);
  }

  if (!role) return <Login onLogin={handleLogin} />;
  if (role === "reception") return <Reception onLogout={handleLogout} />;
  if (role === "doctor")    return <Doctor    onLogout={handleLogout} />;
  if (role === "lab")       return <Lab       onLogout={handleLogout} />;
  if (role === "owner")     return <OwnerShell onLogout={handleLogout} />;
  return null;
}
