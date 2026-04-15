import json, uuid, sqlite3
from datetime import datetime, timedelta, timezone

DB_PATH = "/Users/kathandesai/alvyto/emr.db"

def utc(days_ago=0, hours=0):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago, hours=hours)).isoformat()

def uid():
    return str(uuid.uuid4())

def act(text):
    return {"id": uid(), "text": text, "sourceFactIds": [], "isEdited": False}

def kf(label, category):
    return {"label": label, "category": category}

SARAH = "e001b7fa-00c8-5885-8b57-54451226a4dc"
DR_HARRINGTON = "5e76a2c3-6a33-5f29-a0b0-282f0b379fb1"
DR_CHEN = "47576cc2-7ea8-5210-b57b-d753f6a10f63"
DR_MITCHELL = "5b094c4d-2668-5e94-b6cf-ff826d5eac63"
DR_FLORES = "1480e511-d7f1-59e5-a3dc-8f73d16ef231"
R101 = "944398bb-a5e4-59df-b3ad-2f69ed1f4377"
R102 = "d5e50ae0-f8d3-5d7b-9e31-6d104b358554"
R103 = "5137c7b6-7e7b-510b-b8e2-a8d5e48f71cc"

VISITS = [
  # Visit 1 — EDGE CASE: minimal single chip, early presentation
  {
    "id": uid(),
    "patient_id": SARAH,
    "doctor_id": DR_MITCHELL,
    "room_id": R101,
    "status": "completed",
    "chief_complaint": "Dry, itchy skin on arms and behind knees",
    "created_at": utc(days_ago=600),
    "ended_at": utc(days_ago=600, hours=-1),
    "summary": {
      "clinicalSnapshot": [
        kf("Mild eczema — bilateral antecubital fossae", "symptom"),
      ],
      "doctorActions": [
        act("Hydrocortisone 1% cream applied BID to affected areas"),
        act("Advised fragrance-free moisturizer (CeraVe) QID"),
      ],
      "issuesParagraph": "Sarah Johnson presents with a 3-week history of dry, intensely pruritic patches on both arms and behind the knees. Clinical appearance is consistent with mild atopic dermatitis.",
      "actionsParagraph": "Starting with low-potency topical corticosteroid and barrier repair. Follow up in 6 weeks to reassess response.",
    },
  },

  # Visit 2 — 6 chips, moderate content, worsening
  {
    "id": uid(),
    "patient_id": SARAH,
    "doctor_id": DR_HARRINGTON,
    "room_id": R101,
    "status": "completed",
    "chief_complaint": "Worsening eczema, spreading to neck and chest, poor sleep",
    "created_at": utc(days_ago=480),
    "ended_at": utc(days_ago=480, hours=-1),
    "summary": {
      "clinicalSnapshot": [
        kf("Atopic Dermatitis — moderate severity", "condition"),
        kf("Spreading to neck and anterior chest", "symptom"),
        kf("EASI score 14.2", "result"),
        kf("Sleep disruption — pruritus nocturna", "symptom"),
        kf("Hydrocortisone 1% — inadequate response", "negative"),
        kf("Cetirizine 10mg QD started", "medication"),
      ],
      "doctorActions": [
        act("EASI score documented at 14.2 — moderate disease"),
        act("Stepped up to Clobetasol propionate 0.05% ointment for trunk and neck"),
        act("Cetirizine 10mg QD added for pruritus and sleep"),
        act("Skin prick allergy panel ordered — dust mite, pollen, pet dander"),
        act("Referred to Dr. Harrington (Dermatology) for ongoing management"),
      ],
      "issuesParagraph": "Sarah's atopic dermatitis has progressed beyond mild disease over the past 4 months. Disease has spread to include the neck and anterior chest with an EASI score of 14.2 placing her in the moderate severity range. Low-potency steroids have proven insufficient.",
      "actionsParagraph": "Escalating to Class I topical corticosteroid with adjunct antihistamine. Allergy workup will help identify environmental triggers. Dermatology referral placed for specialist co-management.",
    },
  },

  # Visit 3 — EDGE CASE: ALL category types present in chips
  {
    "id": uid(),
    "patient_id": SARAH,
    "doctor_id": DR_HARRINGTON,
    "room_id": R102,
    "status": "completed",
    "chief_complaint": "Flare after stress at work, new facial involvement, anxiety symptoms",
    "created_at": utc(days_ago=360),
    "ended_at": utc(days_ago=360, hours=-1),
    "summary": {
      "clinicalSnapshot": [
        kf("EASI score 22.7 — moderate-severe", "result"),
        kf("New periorbital involvement", "symptom"),
        kf("Dust mite IgE 12.4 kU/L — elevated", "warning"),
        kf("Clobetasol propionate 0.05% — partial response only", "negative"),
        kf("Tacrolimus 0.1% ointment — face and eyelids", "medication"),
        kf("Stress-triggered flare confirmed", "timing"),
        kf("Generalised xerosis", "condition"),
        kf("Bleach bath therapy 0.005% 2x/week initiated", "action"),
        kf("Avoiding woollen fabrics", "lifestyle"),
      ],
      "doctorActions": [
        act("EASI 22.7 — escalation warranted, approaching severe threshold"),
        act("Tacrolimus 0.1% ointment prescribed for periorbital and facial skin (steroid-sparing)"),
        act("Bleach bath therapy 0.005% sodium hypochlorite 2x weekly initiated"),
        act("Allergy panel confirmed dust mite sensitisation — IgE 12.4 kU/L"),
        act("Discussed trigger avoidance: dust mite-proof mattress and pillow covers"),
        act("Referral to psychiatry for anxiety evaluation — stress is a confirmed disease trigger"),
        act("DLQI questionnaire administered — score 18 (severely impacts quality of life)"),
      ],
      "issuesParagraph": "Sarah presents following a significant occupational stress event with a new flare involving the periorbital region, a particularly sensitive area requiring steroid-sparing therapy. EASI has risen to 22.7. Allergy testing has confirmed dust mite sensitisation as a primary environmental trigger. Psychosocial factors are clearly driving disease activity and require co-management.",
      "actionsParagraph": "Introducing tacrolimus calcineurin inhibitor for the delicate facial skin. Bleach bath protocol initiated to reduce Staphylococcal colonisation. Psychiatric referral placed to address anxiety-AD feedback loop. If EASI does not improve below 16 in 8 weeks, dupilumab candidacy will be assessed.",
    },
  },

  # Visit 4 — EDGE CASE: 15+ chips to test overflow/wrapping
  {
    "id": uid(),
    "patient_id": SARAH,
    "doctor_id": DR_HARRINGTON,
    "room_id": R102,
    "status": "completed",
    "chief_complaint": "Assessment for dupilumab — persistent severe eczema despite topicals",
    "created_at": utc(days_ago=240),
    "ended_at": utc(days_ago=240, hours=-1),
    "summary": {
      "clinicalSnapshot": [
        kf("EASI score 28.4 — severe", "result"),
        kf("SCORAD 58 — severe", "result"),
        kf("IGA score 4 — severe", "result"),
        kf("Chronic lichenification — bilateral arms", "condition"),
        kf("Excoriation marks — trunk and thighs", "symptom"),
        kf("Secondary impetiginisation — right arm", "warning"),
        kf("Staphylococcus aureus colonisation confirmed", "warning"),
        kf("Clobetasol propionate 0.05% — failed", "negative"),
        kf("Tacrolimus 0.1% — partial facial control only", "negative"),
        kf("Dupilumab 300mg SC q2w — approved and initiated", "medication"),
        kf("Cetirizine 10mg QD continued", "medication"),
        kf("Flucloxacillin 500mg QID × 7d — bacterial superinfection", "medication"),
        kf("DLQI 21 — extreme impact on quality of life", "result"),
        kf("Dust mite avoidance measures in place", "lifestyle"),
        kf("Stress management counselling ongoing", "lifestyle"),
        kf("EASI re-check at 16 weeks", "action"),
      ],
      "doctorActions": [
        act("EASI 28.4, SCORAD 58, IGA 4 — severe disease meeting dupilumab threshold"),
        act("PBS/insurance authority obtained for dupilumab (Dupixent) 300mg SC q2w"),
        act("Dupilumab loading dose 600mg administered in clinic today"),
        act("Flucloxacillin 500mg QID × 7 days prescribed for right arm bacterial superinfection"),
        act("Patient education on dupilumab injection technique and storage"),
        act("Requested EASI and SCORAD re-assessment at 16-week mark"),
        act("Continued cetirizine 10mg QD for breakthrough pruritus"),
      ],
      "issuesParagraph": "Sarah has failed two classes of topical therapy — Class I corticosteroids and calcineurin inhibitors. Disease has progressed to severe by all validated measures (EASI 28.4, SCORAD 58, IGA 4). Secondary bacterial infection is present on the right arm. Quality of life is severely impaired with a DLQI of 21. She meets all criteria for biologic therapy.",
      "actionsParagraph": "Initiating dupilumab 300mg SC q2w with a 600mg loading dose today. Concurrent antibiotic course for superinfection. Goals at 16 weeks: EASI reduction ≥75% (EASI-75). If inadequate response, JAK inhibitor therapy (upadacitinib or abrocitinib) will be considered.",
    },
  },

  # Visit 5 — EDGE CASE: 10+ doctorActions, very long paragraphs
  {
    "id": uid(),
    "patient_id": SARAH,
    "doctor_id": DR_HARRINGTON,
    "room_id": R103,
    "status": "completed",
    "chief_complaint": "16-week dupilumab review — significant improvement, conjunctivitis concern",
    "created_at": utc(days_ago=120),
    "ended_at": utc(days_ago=120, hours=-1),
    "summary": {
      "clinicalSnapshot": [
        kf("EASI 8.1 — mild (from 28.4, EASI-75 achieved)", "result"),
        kf("Dupilumab-associated conjunctivitis — bilateral", "warning"),
        kf("Ciclosporin eye drops 1% — prescribed", "medication"),
        kf("Dupilumab 300mg SC q2w — continued", "medication"),
        kf("Pruritus NRS 2/10 — marked improvement", "symptom"),
        kf("DLQI 7 — moderate impact (from 21)", "result"),
        kf("No new superinfection", "negative"),
      ],
      "doctorActions": [
        act("EASI 28.4 → 8.1 — EASI-75 achieved at 16 weeks, excellent biologic response"),
        act("Dupilumab-associated conjunctivitis identified — bilateral, mild-moderate severity"),
        act("Ophthalmology referral placed for dupilumab conjunctivitis management"),
        act("Ciclosporin 1% eye drops (Ikervis) prescribed — 1 drop each eye QHS"),
        act("Dupilumab continued — benefit clearly outweighs conjunctivitis side effect"),
        act("Reduced clobetasol to PRN use only for any breakthrough flares"),
        act("Tacrolimus 0.1% maintained for periorbital maintenance"),
        act("Pruritus NRS improved from 9/10 → 2/10 — patient reported significant quality of life improvement"),
        act("DLQI improved from 21 → 7 — moving from extreme to moderate impact"),
        act("Annual IgE panel and full blood count requested"),
        act("Bleach baths reduced to once weekly — skin barrier significantly improved"),
        act("Sertraline 50mg QD — psychiatry initiated, continuing, anxiety under better control"),
      ],
      "issuesParagraph": "Sarah has demonstrated an outstanding clinical response to dupilumab at her 16-week review. EASI has fallen from 28.4 to 8.1, achieving the EASI-75 benchmark. Pruritus has dramatically improved from NRS 9/10 to 2/10, and quality of life scores have improved markedly with DLQI reducing from 21 to 7. However, she has developed a well-recognised adverse effect — bilateral mild-to-moderate dupilumab-associated conjunctivitis, which requires management but does not warrant biologic discontinuation given the substantial skin disease benefit she has achieved.",
      "actionsParagraph": "Dupilumab will be continued given the exceptional skin response. Ciclosporin ophthalmic emulsion is being introduced for the conjunctivitis, with ophthalmology co-management arranged. Topical steroid has been de-escalated to PRN only — a significant milestone that reflects genuine disease control rather than suppression. The sertraline initiated by psychiatry appears to be contributing positively to her overall inflammatory burden through stress reduction. Annual monitoring bloods have been ordered. Next review in 3 months to consolidate gains and reassess ophthalmological status.",
    },
  },

  # Visit 6 — EDGE CASE: complex medication list with long drug names
  {
    "id": uid(),
    "patient_id": SARAH,
    "doctor_id": DR_HARRINGTON,
    "room_id": R101,
    "status": "completed",
    "chief_complaint": "Routine maintenance review — stable eczema, medication reconciliation",
    "created_at": utc(days_ago=42),
    "ended_at": utc(days_ago=42, hours=-1),
    "summary": {
      "clinicalSnapshot": [
        kf("EASI 5.3 — minimal disease activity", "result"),
        kf("Dupilumab 300mg/2mL SC q2w — maintenance", "medication"),
        kf("Tacrolimus 0.1% ointment — facial maintenance BID", "medication"),
        kf("Ciclosporin ophthalmic emulsion 1mg/mL — 1 drop QHS", "medication"),
        kf("Cetirizine hydrochloride 10mg oral tablet — QD PRN", "medication"),
        kf("Sertraline hydrochloride 100mg oral tablet — QD (dose increased)", "medication"),
        kf("Hydroxyzine hydrochloride 25mg oral tablet — QHS PRN insomnia", "medication"),
        kf("CeraVe Moisturising Cream — QID whole body", "medication"),
        kf("Conjunctivitis resolved — ophthalmology discharged", "negative"),
        kf("No active skin infection", "negative"),
        kf("Stress levels stable — therapy ongoing", "lifestyle"),
      ],
      "doctorActions": [
        act("EASI 5.3 — disease in minimal-activity range, excellent long-term biologic control"),
        act("Full medication reconciliation completed — 7 active medications documented"),
        act("Sertraline dose increased from 50mg to 100mg QD by psychiatry — anxiety management"),
        act("Ciclosporin eye drops discontinued — ophthalmology confirmed complete conjunctivitis resolution"),
        act("Dupilumab continued on current schedule — consider extending to q4w if EASI remains <7 at next review"),
        act("Annual FBC, LFTs, renal function, and IgE panel reviewed — all within normal limits"),
        act("Patient counselled on sun protection given chronic topical immunosuppressant use"),
        act("Next review in 6 months unless flare occurs"),
      ],
      "issuesParagraph": "Sarah is in an excellent stable state at this maintenance review, with EASI at 5.3 representing near-complete disease control. The dupilumab-associated conjunctivitis has fully resolved and ophthalmology has discharged her from their care. Sertraline has been dose-optimised by psychiatry to 100mg QD with good anxiolytic effect, which is contributing to low disease trigger burden. All monitoring bloods remain within normal ranges.",
      "actionsParagraph": "Maintaining current dupilumab schedule with a view to extending dosing interval to q4w at the next review if disease remains controlled. All monitoring parameters are satisfactory. Long-term topical immunosuppressant use warrants ongoing sun protection counselling. Next routine review in 6 months.",
    },
  },
]

def seed():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM visits WHERE patient_id=?", (SARAH,))
    existing = cur.fetchone()[0]
    print(f"Existing visits for Sarah Johnson: {existing}")
    inserted = 0
    for v in VISITS:
        cur.execute("""
            INSERT INTO visits (id,patient_id,doctor_id,room_id,status,chief_complaint,
                transcript,dialogue,summary,created_at,ended_at,approved_at,approved_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            v["id"], v["patient_id"], v["doctor_id"], v["room_id"],
            v["status"], v["chief_complaint"],
            "", json.dumps([]), json.dumps(v["summary"]),
            v["created_at"], v["ended_at"], v["ended_at"], v["doctor_id"]
        ))
        inserted += 1
    con.commit()
    con.close()
    print(f"Inserted {inserted} new visits for Sarah Johnson")
    print(f"Total: {existing + inserted} visits")

if __name__ == "__main__":
    seed()
