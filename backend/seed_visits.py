"""
Seed clinically precise dermatology visit history for existing patients.
Run with:  python3 -m backend.seed_visits
Clear with: python3 -m backend.seed_visits --clear
"""

import sys
import uuid
from datetime import datetime
from backend.database import SessionLocal
from backend import models

def uid(seed: str) -> str:
    """Matches the uid function in backend/seed.py for total data alignment."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"alvyto-v2-{seed}"))

def visit_uuid(seed: str) -> str:
    return uid(f"visit-{seed}")

def action(text: str) -> dict:
    return {"id": str(uuid.uuid4()), "text": text, "sourceFactIds": [], "isEdited": False}

# Resolved DB IDs (Matching backend/seed.py)
P1 = uid("pt-sarah-johnson")
P2 = uid("pt-michael-chen")

DOCTOR1_ID = uid("dr-sarah-mitchell")
DOCTOR2_ID = uid("dr-james-chen")
ROOM2_ID   = uid("room-102")
ROOM3_ID   = uid("room-103")

VISITS = [

    # ══════════════════════════════════════════════════════════════════════════
    # SARAH JOHNSON — Atopic Dermatitis (Eczema)
    # Established patient, 45F. Long history of AD since childhood.
    # Visits track: trigger identification → topical escalation → systemic
    # therapy initiation → Dupilumab response monitoring.
    # ══════════════════════════════════════════════════════════════════════════

    {
        "id":         visit_uuid("sarah-derm-v1"),
        "patient_id": P1,
        "doctor_id":  DOCTOR1_ID,
        "room_id":    ROOM2_ID,
        "status":     "approved",
        "created_at": datetime(2024, 9, 4, 10, 0),
        "ended_at":   datetime(2024, 9, 4, 10, 50),
        "summary": {
            "clinicalSnapshot": [
                {"label": "Atopic Dermatitis",       "category": "symptom"},
                {"label": "EASI score 28.4",         "category": "symptom"},
                {"label": "antecubital + neck",      "category": "symptom"},
                {"label": "severe pruritus NRS 8/10","category": "symptom"},
                {"label": "dust mite IgE elevated",  "category": "warning"},
                {"label": "Clobetasol failed",       "category": "negative"},
                {"label": "sleep disruption",        "category": "symptom"},
                {"label": "stress trigger confirmed","category": "timing"},
            ],
            "doctorActions": [
                action("EASI 28.4 — severe AD documented"),
                action("IgE panel + skin prick test ordered"),
                action("Patch test — fragrance, nickel, rubber"),
                action("Clobetasol discontinued — <20% EASI reduction"),
                action("Mometasone 0.1% cream — body, max 2 weeks"),
                action("Pimecrolimus 1% — face + folds"),
                action("Cetirizine 10mg nightly"),
                action("CeraVe — apply within 3min of bathing"),
                action("Wet wrap demonstrated — antecubital plaques"),
                action("Dust mite protocol issued"),
                action("CBT referral — itch-scratch cycle"),
                action("Review in 8 weeks with IgE results"),
            ],
            "issuesParagraph": (
                "Sarah Johnson, a 45-year-old woman with a childhood history of atopic dermatitis, presented with a severe generalised flare "
                "involving bilateral antecubital fossae, posterior neck, periorbital skin, and upper chest. EASI score was calculated at 28.4, placing "
                "her firmly in the severe category (>21). The patient reported intense, refractory pruritus rated 8 out of 10 on the NRS, with significant "
                "sleep disruption — waking 3 to 4 times per night due to itch. She described profound psychological distress, rating DLQI at 22/30. "
                "A 6-week trial of Clobetasol propionate 0.05% ointment applied twice daily had achieved less than 20% EASI reduction, meeting the "
                "definition of inadequate response to Class I topical corticosteroids. Clinical examination revealed bilateral antecubital lichenification "
                "with excoriation marks, weeping at the posterior neck, and erythematous xerotic plaques on the upper chest. Serum IgE was grossly elevated "
                "at 1,840 IU/mL. A concurrent trigger review identified house dust mite sensitisation as the primary environmental allergen based on history, "
                "confirmed by early prick test reactivity, with psychological stress consistently precipitating flares within 48 to 72 hours of onset."
            ),
            "actionsParagraph": (
                "Given the inadequate response to Class I topical corticosteroids and EASI score of 28.4, management was stepped up. Clobetasol was discontinued "
                "and Mometasone furoate 0.1% cream was introduced for body flares, with strict limitation to two-week courses per site to prevent cutaneous atrophy. "
                "Pimecrolimus 1% cream was initiated for facial, neck, and intertriginous involvement, exploiting its steroid-sparing properties without the risk "
                "of skin thinning. Wet wrap therapy was demonstrated for lichenified antecubital plaques to enhance TCS penetration. Systemic antihistamines were "
                "added for nocturnal symptom control. Full sensitisation panel and patch testing were ordered to guide allergen avoidance. Comprehensive dust mite "
                "mitigation was counselled. The threshold for systemic therapy — specifically Dupilumab — was discussed and the patient was informed this would be "
                "formally considered at the next visit if EASI remained above 16. Follow-up was set for eight weeks."
            ),
        },
    },

    {
        "id":         visit_uuid("sarah-derm-v2"),
        "patient_id": P1,
        "doctor_id":  DOCTOR1_ID,
        "room_id":    ROOM2_ID,
        "status":     "approved",
        "created_at": datetime(2024, 11, 6, 9, 30),
        "ended_at":   datetime(2024, 11, 6, 10, 20),
        "summary": {
            "clinicalSnapshot": [
                {"label": "EASI 24.1 (still severe)", "category": "symptom"},
                {"label": "IgE 1840 IU/mL",           "category": "warning"},
                {"label": "D. pteronyssinus +++",      "category": "warning"},
                {"label": "fragrance mix positive",    "category": "warning"},
                {"label": "Pimecrolimus tolerated",    "category": "medication"},
                {"label": "Dupilumab initiated",       "category": "medication"},
                {"label": "DLQI 22/30",                "category": "symptom"},
                {"label": "secondary infection cleared","category": "negative"},
            ],
            "doctorActions": [
                action("D. pteronyssinus Class 4 — HDM confirmed"),
                action("Fragrance mix ++ — contact allergy confirmed"),
                action("All fragranced products discontinued"),
                action("Staph aureus resolved — Fusidic acid completed"),
                action("Dupilumab 600mg loading dose given in clinic"),
                action("Dupilumab 300mg Q2W — self-injection trained"),
                action("Mometasone — rescue only, max 7 days/flare"),
                action("Pimecrolimus continued — face + neck"),
                action("Conjunctivitis risk counselled"),
                action("Baseline bloods — biologic registry entry"),
                action("Biologic registry opened"),
                action("Review in 16 weeks"),
            ],
            "issuesParagraph": (
                "Sarah Johnson returned for her 8-week review. EASI score had marginally improved to 24.1 from 28.4, but remained in the severe category, "
                "representing only a 15% reduction — insufficient for an adequate treatment response. She reported partial improvement in daytime itch but "
                "negligible change in nocturnal symptoms. A superinfection with Staphylococcus aureus had developed over the right antecubital fossa two weeks "
                "after the last visit, treated empirically with Fusidic acid 2% cream, and was confirmed fully resolved today on examination. "
                "IgE results confirmed HDM as the dominant allergen with D. pteronyssinus at 42.5 kU/L (Class 4) and D. farinae at 38.1 kU/L (Class 4). "
                "Patch testing revealed a clinically relevant contact allergy to fragrance mix I (++) and balsam of Peru (+), indicating a concurrent allergic "
                "contact dermatitis component overlying the atopic disease — a critical finding as fragrance-containing products were in active use. "
                "DLQI remained at 22/30, reflecting profound quality-of-life impairment. With two failed topical steroid regimens and persistent severe disease "
                "meeting NICE TA534 criteria, the patient fulfilled requirements for biologic therapy initiation."
            ),
            "actionsParagraph": (
                "Dupilumab was initiated at the standard 600mg loading dose administered as two simultaneous 300mg subcutaneous injections in clinic. "
                "The patient was trained on self-injection technique for the 300mg maintenance dose every two weeks. All fragranced products were immediately "
                "discontinued given the confirmed contact allergy — this was considered a modifiable exacerbant and expected to independently contribute to "
                "improved disease control. Mometasone was repositioned as rescue-only therapy with strict instruction against prophylactic use. "
                "Baseline bloodwork was obtained for biologic registry entry. Complete response assessment with EASI re-scoring was planned at 16 weeks, "
                "consistent with NICE-mandated response criteria for Dupilumab continuation (EASI-50 required, EASI-75 target)."
            ),
        },
    },

    {
        "id":         visit_uuid("sarah-derm-v3"),
        "patient_id": P1,
        "doctor_id":  DOCTOR1_ID,
        "room_id":    ROOM2_ID,
        "status":     "approved",
        "created_at": datetime(2025, 3, 12, 11, 0),
        "ended_at":   datetime(2025, 3, 12, 11, 45),
        "summary": {
            "clinicalSnapshot": [
                {"label": "EASI 8.3 (moderate)",    "category": "symptom"},
                {"label": "EASI-75 achieved",        "category": "medication"},
                {"label": "Dupilumab 16wk response","category": "medication"},
                {"label": "dupilumab conjunctivitis","category": "warning"},
                {"label": "NRS itch 3/10",           "category": "symptom"},
                {"label": "face clear",              "category": "negative"},
                {"label": "residual neck plaques",   "category": "symptom"},
                {"label": "fragrance avoidance maintained","category": "lifestyle"},
            ],
            "doctorActions": [
                action("EASI 8.3 — 70.8% reduction, EASI-50 met"),
                action("NRS 3/10 — 62.5% itch reduction"),
                action("DLQI 9/30 — down from 22"),
                action("Dupilumab conjunctivitis — bilateral, moderate"),
                action("Ophthalmology referred — tobramycin/dexa drops started"),
                action("Tacrolimus 0.1% periorbital — replacing Pimecrolimus"),
                action("Dupilumab 300mg Q2W continued"),
                action("Betamethasone + occlusion x5 nights — neck plaques"),
                action("Fragrance avoidance confirmed"),
                action("HDM avoidance confirmed — allergy nurse reviewed"),
                action("Consider Crisaborole if neck persists at 24 weeks"),
                action("Review in 12 weeks + ophthal co-report"),
            ],
            "issuesParagraph": (
                "Sarah Johnson attended her 16-week Dupilumab response assessment. EASI score had fallen to 8.3 from a baseline of 28.4 — a 70.8% reduction. "
                "While the formal EASI-75 threshold of 7.1 was narrowly missed, the clinical response was unambiguously meaningful, with EASI-50 far exceeded. "
                "Pruritus NRS improved to 3/10 from 8/10 at baseline, and the patient reported sleeping through the night for the first time in over a year. "
                "DLQI reduced from 22 to 9, with the patient returning to work without distraction and beginning to socialise again. "
                "The face and antecubital fossae were completely clear. The one area of residual disease was the posterior neck, with two lichenified plaques "
                "approximately 3cm x 4cm in size, consistent with habitual rubbing. "
                "A new complication was identified: bilateral dupilumab-associated conjunctivitis presenting as lid margin erythema and conjunctival injection. "
                "This is a well-recognised and mechanism-related adverse effect occurring in approximately 10% of patients on Dupilumab for AD, attributed to "
                "impaired goblet cell mucin production secondary to IL-13 blockade in conjunctival tissue. Severity was moderate, requiring ophthalmological review."
            ),
            "actionsParagraph": (
                "Dupilumab was continued given the substantial disease control benefit. Ophthalmology was referred for slit-lamp assessment of the conjunctivitis, "
                "and topical tobramycin/dexamethasone drops were initiated as a bridging measure. Tacrolimus 0.1% ointment replaced Pimecrolimus on periorbital skin, "
                "as it offers superior penetration and anti-inflammatory potency. Residual neck plaques were treated with an intensive occlusive betamethasone regimen "
                "for five nights. The patient's fragrance avoidance was confirmed and praised — this was assessed as contributing to the improved facial clearance. "
                "EASI re-scoring was scheduled at 24 weeks to make the formal NICE continuation decision."
            ),
        },
    },

    {
        "id":         visit_uuid("sarah-derm-v4"),
        "patient_id": P1,
        "doctor_id":  DOCTOR1_ID,
        "room_id":    ROOM2_ID,
        "status":     "approved",
        "created_at": datetime(2025, 6, 18, 10, 15),
        "ended_at":   datetime(2025, 6, 18, 11, 5),
        "summary": {
            "clinicalSnapshot": [
                {"label": "EASI 5.1 (mild)",         "category": "symptom"},
                {"label": "EASI-75 achieved",         "category": "medication"},
                {"label": "Dupilumab 9 months",       "category": "medication"},
                {"label": "conjunctivitis resolved",  "category": "negative"},
                {"label": "NRS itch 1/10",            "category": "symptom"},
                {"label": "new flexural flare",       "category": "warning"},
                {"label": "heat + sweating trigger",  "category": "timing"},
                {"label": "DLQI 4/30",                "category": "symptom"},
            ],
            "doctorActions": [
                action("EASI 5.1 — 82% reduction, EASI-75 met"),
                action("DLQI 4/30 — near-minimal disease impact"),
                action("NRS 1/10 — near-complete itch resolution"),
                action("Conjunctivitis resolved — no structural changes"),
                action("New flare — axillae + right popliteal fossa"),
                action("Desonide 0.05% lotion — intertriginous sites"),
                action("Fragranced antiperspirant switched"),
                action("Cotton clothing + post-exercise shower advised"),
                action("Dupilumab 300mg Q2W continued"),
                action("Annual safety bloods ordered"),
                action("6-month review interval approved"),
                action("Self-rescue: Mometasone within 48hr of flare"),
            ],
            "issuesParagraph": (
                "Sarah Johnson attended her 9-month Dupilumab review with EASI formally at 5.1 — an 82% reduction from the baseline of 28.4 — meeting the NICE TA534 "
                "criterion for continuation. NRS pruritus was 1/10, and the patient described her skin as 'essentially normal for the first time in decades.' "
                "DLQI had fallen to 4/30, indicating near-minimal disease impact. Ophthalmology confirmed complete resolution of the dupilumab-associated conjunctivitis "
                "with no structural sequelae. However, a new localised flare was noted in the right popliteal fossa and bilateral axillae, appearing approximately "
                "three weeks prior to the visit during a period of unusually warm weather. Sweating and heat occlusion in flexural sites are a recognised and distinct "
                "trigger for atopic dermatitis — separate from the original HDM and fragrance triggers — and represent an important management consideration as the "
                "underlying disease remains reactive at these anatomical sites even with excellent systemic control. The axillary antiperspirant in use contained "
                "fragrance, which was also identified as a contributory irritant."
            ),
            "actionsParagraph": (
                "NICE-compliant continuation of Dupilumab was approved. The new flexural flare was addressed with Desonide 0.05% lotion, selected for its "
                "low-potency profile appropriate to intertriginous skin at risk of striae with higher-potency agents. Sweat trigger management was addressed "
                "with practical behavioural strategies and clothing advice. The fragranced antiperspirant was replaced. Annual biologic safety bloods were "
                "ordered. Given the achieved and sustained disease control, review intervals were extended to every six months, with patient-initiated rescue "
                "using Mometasone within 48 hours of any flare onset — a step towards guided self-management consistent with the Global AD Forum recommendations."
            ),
        },
    },

    # ══════════════════════════════════════════════════════════════════════════
    # MICHAEL CHEN — Moderate-to-Severe Plaque Psoriasis
    # 68M. Psoriasis diagnosed age 52. Comorbidities: psoriatic arthritis
    # (PsA) and metabolic syndrome. Visits track: PASI-based therapy
    # escalation from MTX → Apremilast → Secukinumab, with PsA monitoring.
    # ══════════════════════════════════════════════════════════════════════════

    {
        "id":         visit_uuid("michael-derm-v1"),
        "patient_id": P2,
        "doctor_id":  DOCTOR2_ID,
        "room_id":    ROOM3_ID,
        "status":     "approved",
        "created_at": datetime(2024, 8, 14, 14, 0),
        "ended_at":   datetime(2024, 8, 14, 15, 0),
        "summary": {
            "clinicalSnapshot": [
                {"label": "Plaque Psoriasis",         "category": "symptom"},
                {"label": "PASI 18.2",                "category": "symptom"},
                {"label": "BSA 22%",                  "category": "symptom"},
                {"label": "Methotrexate failed",      "category": "negative"},
                {"label": "PsA — DIP joints",         "category": "symptom"},
                {"label": "LFT raised on MTX",        "category": "warning"},
                {"label": "alcohol trigger",          "category": "warning"},
                {"label": "Koebner scalp + elbows",   "category": "symptom"},
            ],
            "doctorActions": [
                action("PASI 18.2, BSA 22% — moderate-to-severe confirmed"),
                action("Methotrexate stopped — ALT 3× ULN + poor response"),
                action("FibroScan ordered — cumulative MTX 1,560mg"),
                action("Alcohol 21u/week — abstinence counselled"),
                action("PsA — DIP swelling bilateral, DAS28 3.8"),
                action("Rheumatology referral — urgent"),
                action("Apremilast 30mg BD — titration schedule given"),
                action("GI side effects warned — take with food"),
                action("Enstilar foam — scalp + elbows"),
                action("Diprobase 500g — twice daily after bathing"),
                action("Koebner counselled — avoid friction sites"),
                action("Review in 12 weeks"),
            ],
            "issuesParagraph": (
                "Michael Chen, a 68-year-old man with a 16-year history of plaque psoriasis, attended with disease that had deteriorated significantly over the preceding "
                "four months. PASI was calculated at 18.2 and BSA at 22%, involving bilateral elbows (thick, fissured plaques up to 8cm diameter), the entire scalp "
                "with diffuse silvery scale and occipital hairline involvement, bilateral shins, and the periumblical region. He described severe pruritus and "
                "embarrassment preventing him from wearing short sleeves. Methotrexate 20mg/week had been the backbone of his therapy for 18 months but had delivered "
                "only a 28% PASI reduction — far below the 75% target — and was now complicated by hepatotoxicity with ALT readings at 3x the upper limit of normal on "
                "two consecutive monthly blood tests. Alcohol consumption was identified at 21 units per week, a significant hepatotoxic co-factor. Koebnerisation was "
                "evident at friction sites — the scalp from repeated scratching and the elbows from desk contact. Psoriatic arthritis was identified as a significant "
                "new comorbidity: distal interphalangeal joint swelling was present in four fingers bilaterally, nail changes included onycholysis and classic oil-drop "
                "sign, and DAS28-CRP was 3.8, indicating moderate joint disease activity requiring independent management."
            ),
            "actionsParagraph": (
                "Methotrexate was discontinued immediately given the hepatotoxicity signal, and a FibroScan was ordered to exclude hepatic fibrosis given the cumulative "
                "dose exposure of 1,560mg. Apremilast was selected as the bridging systemic therapy — it addresses both skin and joint disease, carries no hepatotoxic "
                "risk, and does not require the same monitoring burden as MTX. A detailed titration schedule was given to minimise GI adverse effects. Enstilar foam "
                "was prescribed for scalp and elbow plaques given its superior efficacy in thick plaque disease. Rheumatology co-management was arranged urgently. "
                "Alcohol cessation was emphasised as both a hepatoprotective and anti-inflammatory measure — alcohol consumption directly upregulates TNF-alpha and IL-17 "
                "pathways relevant to psoriasis pathogenesis."
            ),
        },
    },

    {
        "id":         visit_uuid("michael-derm-v2"),
        "patient_id": P2,
        "doctor_id":  DOCTOR2_ID,
        "room_id":    ROOM3_ID,
        "status":     "approved",
        "created_at": datetime(2024, 11, 20, 10, 30),
        "ended_at":   datetime(2024, 11, 20, 11, 30),
        "summary": {
            "clinicalSnapshot": [
                {"label": "PASI 14.6 (partial response)", "category": "symptom"},
                {"label": "Apremilast 12 weeks",           "category": "medication"},
                {"label": "BSA 18%",                       "category": "symptom"},
                {"label": "PsA worsening",                 "category": "warning"},
                {"label": "FibroScan F2 fibrosis",         "category": "warning"},
                {"label": "alcohol reduced to 6u/week",    "category": "lifestyle"},
                {"label": "scalp improved",                "category": "negative"},
                {"label": "elbow plaques persistent",      "category": "symptom"},
            ],
            "doctorActions": [
                action("PASI 14.6 — Apremilast PASI-50 not achieved"),
                action("BSA 18% — scalp 60% clear, elbows unchanged"),
                action("FibroScan F2 fibrosis — MTX permanently contraindicated"),
                action("Alcohol 6u/week — continue reducing"),
                action("PsA DAS28 4.5 — MRI erosion at 3rd DIP"),
                action("Secukinumab 300mg initiated — week 0 dose given"),
                action("Apremilast discontinued"),
                action("TB (IGRA) + Hep B/C — all clear"),
                action("Flu vaccine administered"),
                action("Enstilar foam continued during induction"),
                action("Hepatology co-management initiated"),
                action("Review in 12 weeks — PASI-75 + DAS28"),
            ],
            "issuesParagraph": (
                "Michael Chen returned at 12 weeks on Apremilast. PASI had reduced to 14.6 (BSA 18%), representing only a 19.8% improvement — well below the PASI-50 "
                "threshold that would constitute an adequate response. Scalp disease had partially improved with approximately 60% clearance, but elbow and bilateral "
                "shin plaques were essentially unchanged. The FibroScan result returned a liver stiffness of 8.4 kPa, consistent with Metavir F2 fibrosis, "
                "almost certainly attributable to the cumulative MTX exposure compounded by prior alcohol use — Methotrexate is now permanently contraindicated for this "
                "patient. Alcohol intake had been meaningfully reduced to 6 units per week, which was acknowledged positively. The Rheumatology co-letter was reviewed "
                "and was concerning: DAS28-CRP had risen to 4.5 and MRI of the right hand showed early erosive change at the third DIP joint, indicating progressive "
                "structural joint damage occurring despite Apremilast. The convergence of inadequate skin response and worsening PsA with early erosive change "
                "constituted a clear indication for escalation to biologic therapy."
            ),
            "actionsParagraph": (
                "Secukinumab 300mg was selected in joint discussion with Rheumatology for its Class I evidence base in both moderate-to-severe plaque psoriasis and "
                "psoriatic arthritis with peripheral joint involvement, including PsA-associated erosive disease. The IL-17A mechanism also avoids hepatotoxic risk, "
                "appropriate given confirmed F2 fibrosis. Loading doses were initiated at weeks 0, 1, 2, 3, and 4, followed by monthly 300mg maintenance. "
                "All mandatory pre-biologic screening — IGRA, hepatitis serology, vaccination review — was completed. Flu vaccination was administered. "
                "Apremilast was discontinued. Enstilar foam was continued for residual elbow plaques during the induction phase to provide topical support "
                "while systemic levels of Secukinumab were building."
            ),
        },
    },

    {
        "id":         visit_uuid("michael-derm-v3"),
        "patient_id": P2,
        "doctor_id":  DOCTOR2_ID,
        "room_id":    ROOM3_ID,
        "status":     "approved",
        "created_at": datetime(2025, 2, 26, 9, 0),
        "ended_at":   datetime(2025, 2, 26, 10, 0),
        "summary": {
            "clinicalSnapshot": [
                {"label": "PASI 4.8",               "category": "symptom"},
                {"label": "PASI-75 achieved",        "category": "medication"},
                {"label": "Secukinumab 12 weeks",    "category": "medication"},
                {"label": "PsA DAS28 2.4",           "category": "symptom"},
                {"label": "scalp clear",             "category": "negative"},
                {"label": "candidal intertrigo",     "category": "warning"},
                {"label": "elbows near-clear",       "category": "negative"},
                {"label": "DLQI 6/30",               "category": "symptom"},
            ],
            "doctorActions": [
                action("PASI 4.8 — PASI-75 achieved, Secukinumab confirmed"),
                action("DAS28-CRP 2.4 — PsA low disease activity"),
                action("DLQI 6/30 — significant QoL improvement"),
                action("Scalp clear — Enstilar discontinued"),
                action("Right elbow: 2cm residual scale only"),
                action("Candidal intertrigo bilateral — Clotrimazole 1% x2 weeks"),
                action("IL-17 candida risk counselled"),
                action("Secukinumab 300mg monthly continued"),
                action("Repeat FibroScan in 6 months"),
                action("Fasting lipid panel + HbA1c ordered"),
                action("Dietitian referral — Mediterranean diet"),
                action("Review in 6 months"),
            ],
            "issuesParagraph": (
                "Michael Chen attended his 12-week Secukinumab response assessment with a PASI of 4.8 — a 73.6% reduction from his pre-biologic baseline of 18.2, "
                "meeting the PASI-75 continuation criterion. The scalp was completely clear. Elbow involvement was reduced to a single 2cm x 1cm patch of residual "
                "scale at the right lateral elbow without active inflammation. Bilateral shin plaques had resolved. DLQI improved markedly. The Rheumatology co-report "
                "noted DAS28-CRP at 2.4 — low disease activity — representing a substantial response, with the patient reporting he could now grip objects without pain "
                "and had returned to his morning walks. An adverse effect was identified: bilateral inguinal candidal intertrigo, characterised by well-demarcated "
                "erythematous plaques with satellite pustules. This represents a recognised and mechanism-based complication of IL-17A inhibition — the IL-17 pathway "
                "is a critical component of mucocutaneous immunity against Candida albicans, and its blockade increases susceptibility, particularly in intertriginous "
                "areas. Metabolic review noted a BMI of 31.2 and waist circumference of 104cm, consistent with metabolic syndrome — an independent cardiovascular "
                "risk factor and comorbidity known to perpetuate psoriasis inflammation through adipokine dysregulation."
            ),
            "actionsParagraph": (
                "Secukinumab was continued following formal PASI-75 achievement. The candidal intertrigo was treated with Clotrimazole 1% cream and specific hygiene "
                "advice. The patient was counselled on the mechanism-based candida risk and instructed to report recurrence promptly. Hepatology follow-up was arranged "
                "to monitor F2 fibrosis in the absence of ongoing MTX exposure, with a repeat FibroScan in six months. Metabolic syndrome management was addressed "
                "with a dietitian referral favouring the Mediterranean dietary pattern, which has the strongest evidence base for both cardiovascular risk reduction "
                "and psoriasis anti-inflammatory benefit through omega-3 fatty acid and polyphenol content. Review interval was extended to six months given the "
                "confirmed PASI-75 response and clinical stability."
            ),
        },
    },

    {
        "id":         visit_uuid("michael-derm-v4"),
        "patient_id": P2,
        "doctor_id":  DOCTOR2_ID,
        "room_id":    ROOM3_ID,
        "status":     "approved",
        "created_at": datetime(2025, 6, 11, 14, 30),
        "ended_at":   datetime(2025, 6, 11, 15, 20),
        "summary": {
            "clinicalSnapshot": [
                {"label": "PASI 6.9",                  "category": "symptom"},
                {"label": "PASI-75 borderline",         "category": "warning"},
                {"label": "Secukinumab 9 months",       "category": "medication"},
                {"label": "stress-induced flare",       "category": "timing"},
                {"label": "new guttate lesions trunk",  "category": "warning"},
                {"label": "throat infection preceded",  "category": "timing"},
                {"label": "PsA stable DAS28 2.6",       "category": "symptom"},
                {"label": "FibroScan F1 (improving)",   "category": "negative"},
            ],
            "doctorActions": [
                action("PASI 6.9 — partial loss of response"),
                action("50+ guttate lesions trunk — post-streptococcal"),
                action("Strep pyogenes confirmed — Penicillin V 500mg QDS x10d"),
                action("Occupational stress x6 weeks — confirmed cofactor"),
                action("Clobetasol foam — guttate lesions, 2 weeks"),
                action("Secukinumab 300mg monthly continued"),
                action("MBSR 8-week programme referral"),
                action("FibroScan 6.1 kPa — improved to F1"),
                action("Hepatology discharged — annual scan only"),
                action("PsA DAS28 2.6 — stable"),
                action("Repeat PASI in 8 weeks"),
                action("Escalate to Q2W if PASI stays >7.3"),
            ],
            "issuesParagraph": (
                "Michael Chen attended his 9-month Secukinumab review with a PASI of 6.9 — an increase from 4.8 at the 12-week assessment. While still representing "
                "a 62% improvement from the original baseline, this constitutes a partial loss of response at this visit, falling below the formal PASI-75 threshold "
                "of 4.55. Two distinct precipitating factors were identified. First, the patient reported a streptococcal pharyngitis treated empirically by his GP "
                "six weeks prior — a throat swab today confirmed residual Streptococcus pyogenes carriage, and approximately 50 to 60 new guttate-pattern lesions "
                "(0.5 to 1cm, erythematous, teardrop-shaped) had appeared across the trunk in the weeks following. Streptococcal exotoxins functioning as superantigens "
                "are a well-characterised trigger for guttate psoriasis through T-cell polyclonal activation, and this mechanism can transiently overwhelm even effective "
                "biologic control. Second, a period of high occupational stress lasting approximately six weeks was documented — psychosocial stress activates "
                "the HPA axis and triggers keratinocyte expression of substance P and nerve growth factor, both of which independently drive psoriatic inflammation. "
                "Importantly, PsA remained stable at DAS28-CRP 2.6 throughout the flare, suggesting the biologic is maintaining joint protection specifically. "
                "A welcome finding was the FibroScan result of 6.1 kPa — an improvement from 8.4 kPa at the previous scan — indicating regression of fibrosis towards "
                "the low F1 range, attributable to MTX elimination and significant alcohol reduction."
            ),
            "actionsParagraph": (
                "The partial loss of response was attributed to identifiable and treatable triggers rather than primary biologic failure. Streptococcal eradication was "
                "prioritised with a 10-day course of Phenoxymethylpenicillin, the drug of choice for Streptococcus pyogenes given its narrow-spectrum profile. "
                "A short course of Clobetasol foam was prescribed for the guttate lesions. Secukinumab was continued at the standard monthly dose with the expectation "
                "that removing the infective trigger would restore prior response. Stress management was addressed via referral to a validated MBSR programme — "
                "the Kabat-Zinn 8-week protocol has RCT evidence specifically in psoriasis patients demonstrating a 50% reduction in flare frequency and accelerated "
                "UV therapy response. Dose intensification to fortnightly Secukinumab was documented as the contingency plan if PASI does not return below 7.3 "
                "following trigger resolution. The hepatology pathway was closed with annual FibroScan follow-up only, given the encouraging fibrosis regression data."
            ),
        },
    },
]


def seed_visits(clear: bool = False):
    db = SessionLocal()
    try:
        all_ids = [v["id"] for v in VISITS]

        if clear:
            # Also wipe any previously seeded visits by old UUIDs
            old_patient_uuids = [
                str(uuid.uuid5(uuid.NAMESPACE_DNS, "alvyto-seed-patient-sarah-johnson")),
                str(uuid.uuid5(uuid.NAMESPACE_DNS, "alvyto-seed-patient-michael-chen")),
            ]
            deleted = (
                db.query(models.Visit)
                .filter(
                    models.Visit.patient_id.in_(old_patient_uuids + ["p1", "p2"])
                )
                .delete(synchronize_session=False)
            )
            db.commit()
            print(f"Cleared {deleted} visit(s) for p1 and p2.")
            return

        inserted = 0
        skipped  = 0
        for vdata in VISITS:
            existing = db.query(models.Visit).filter(models.Visit.id == vdata["id"]).first()
            if existing:
                skipped = skipped + 1
                continue
            visit = models.Visit(
                id=vdata["id"],
                patient_id=vdata["patient_id"],
                doctor_id=vdata["doctor_id"],
                room_id=vdata["room_id"],
                status=vdata["status"],
                summary=vdata["summary"],
                transcript="",
                dialogue=[],
                created_at=vdata["created_at"],
                ended_at=vdata["ended_at"],
            )
            db.add(visit)
            inserted = inserted + 1

        db.commit()
        print(f"Seeded {inserted} visit(s). Skipped {skipped} already existing.")
    finally:
        db.close()


if __name__ == "__main__":
    clear = "--clear" in sys.argv
    seed_visits(clear=clear)
