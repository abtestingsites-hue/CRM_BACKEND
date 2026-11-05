export interface FoundationCatalogDefinition {
  key: string;
  name: string;
  category: string;
  enquiryCategories?: Array<{
    value: string;
    label: string;
    subcategories: string[];
  }>;
  services: Array<{
    name: string;
    code: string;
    subcategory?: string;
    isEmergency?: boolean;
    subServices?: string[];
    description?: string;
  }>;
}

export const PRIMARY_ORGANIZATIONS = [
  { key: 'UEC', name: 'Universal Elder Care', label: 'UEC — Universal Elder Care' },
  { key: 'UNCF', name: 'Universal Nature Care & Cure Foundation', label: 'UNCF — Universal Nature Care & Cure Foundation' },
  { key: 'ACARE', name: 'Ambulance & Care', label: 'ACARE — Ambulance & Care' },
  { key: 'HOME_CARE', name: 'Home Care Services', label: 'HOME_CARE — Home Care Services' },
];

export const INITIAL_FOUNDATIONS: FoundationCatalogDefinition[] = [
  // 1. BUSINESS UNIT 1: UEC (10 Services)
  {
    key: 'UEC',
    name: 'Universal Elder Care',
    category: 'Elderly Care & Clinical Coordination',
    enquiryCategories: [
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Service Enquiry',
        subcategories: [
          'Elderly Care Services',
          'Patient Care Coordination',
          'Medical Care Support',
          'Nursing Services',
          'Doctor Consultation Coordination',
          'Health Monitoring',
          'Patient Intake & Assessment',
          'Hospital & Appointment Coordination',
          'Post-Hospitalization Care',
          'Emergency Care Coordination',
        ],
      },
      {
        value: 'JOB_ENQUIRY',
        label: 'Job Enquiry / Careers',
        subcategories: ['Staff Nurse', 'Care Attendant', 'Administrative / Facility'],
      },
      {
        value: 'GENERAL_ENQUIRY',
        label: 'General Enquiry',
        subcategories: ['Admission Enquiry', 'Facility Tour', 'Pricing & Packages'],
      },
      {
        value: 'COMPLAINT_OR_SUPPORT',
        label: 'Complaint / Support',
        subcategories: ['Resident Care Feedback', 'Billing Support', 'Family Escalation'],
      },
    ],
    services: [
      {
        name: 'Elderly Care Services',
        code: 'UEC_ELDERLY_CARE',
        subcategory: 'Elderly Care Services',
        description: 'Comprehensive residential and personal care assistance for seniors.',
        subServices: ['Daily Living Assistance', 'Personal Care Support', 'Nutrition & Meal Care'],
      },
      {
        name: 'Patient Care Coordination',
        code: 'UEC_PATIENT_CARE_COORD',
        subcategory: 'Patient Care Coordination',
        description: 'Integrated daily living and care plan management for residents.',
        subServices: ['Care Plan Design', 'Daily Attendant Scheduling', 'Progress Tracking'],
      },
      {
        name: 'Medical Care Support',
        code: 'UEC_MEDICAL_CARE_SUPPORT',
        subcategory: 'Medical Care Support',
        description: 'Physician-supervised clinical support and medication management.',
        subServices: ['Medication Administration', 'Vitals Charting', 'Physician Liaison'],
      },
      {
        name: 'Nursing Services',
        code: 'UEC_NURSING_SERVICES',
        subcategory: 'Nursing Services',
        description: '24/7 round-the-clock professional nursing, wound care, and catheter support.',
        subServices: ['Wound Dressing', 'IV/Infusion Therapy', 'Catheter & Stoma Care'],
      },
      {
        name: 'Doctor Consultation Coordination',
        code: 'UEC_DOCTOR_CONSULT',
        subcategory: 'Doctor Consultation Coordination',
        description: 'Routine and specialist physician visit scheduling and telehealth consults.',
        subServices: ['Geriatrician Review', 'Specialist Teleconsult', 'Prescription Renewal'],
      },
      {
        name: 'Health Monitoring',
        code: 'UEC_HEALTH_MONITORING',
        subcategory: 'Health Monitoring',
        description: 'Continuous monitoring of vitals, blood sugar, SpO2, and clinical flags.',
        subServices: ['Daily Vitals Recording', 'Blood Glucose Tracking', 'Cardiac Rhythm Alert'],
      },
      {
        name: 'Patient Intake & Assessment',
        code: 'UEC_INTAKE_ASSESSMENT',
        subcategory: 'Patient Intake & Assessment',
        description: 'Pre-admission comprehensive physical, cognitive, and functional assessments.',
        subServices: ['ADL Functional Index', 'Cognitive Assessment', 'Mobility Check'],
      },
      {
        name: 'Hospital & Appointment Coordination',
        code: 'UEC_HOSPITAL_APPT_COORD',
        subcategory: 'Hospital & Appointment Coordination',
        description: 'Liaison with external multi-specialty hospitals and diagnostic laboratories.',
        subServices: ['OPD Transport Liaison', 'Lab Diagnostic Booking', 'Discharge Summary Review'],
      },
      {
        name: 'Post-Hospitalization Care',
        code: 'UEC_POST_HOSPITAL_CARE',
        subcategory: 'Post-Hospitalization Care',
        description: 'Post-surgical recovery, sub-acute rehabilitation, and physiotherapy follow-up.',
        subServices: ['Post-Op Wound Management', 'Rehabilitation Mobility', 'Pain Management'],
      },
      {
        name: 'Emergency Care Coordination',
        code: 'UEC_EMERGENCY_CARE_COORD',
        subcategory: 'Emergency Care Coordination',
        isEmergency: true,
        description: 'Immediate critical care response, telemetry escalation, and hospital transfer.',
        subServices: ['Emergency Triage', 'Ambulance Dispatch Alert', 'Emergency Hospital Transfer'],
      },
    ],
  },

  // 2. BUSINESS UNIT 2: UNCF (10 Services)
  {
    key: 'UNCF',
    name: 'Universal Nature Care & Cure Foundation',
    category: 'Community Healthcare & Philanthropic Welfare',
    enquiryCategories: [
      {
        value: 'DONOR_ENQUIRY',
        label: 'Donor Enquiry / Philanthropy',
        subcategories: ['CSR Partnership', 'Individual Donation', 'Patient Subsidy Sponsorship', 'Healthcare Fundraising'],
      },
      {
        value: 'VOLUNTEER_ENQUIRY',
        label: 'Volunteer Enquiry',
        subcategories: ['Elder Companionship', 'Health Camps Volunteer', 'Community Outreach'],
      },
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Trust Healthcare Services',
        subcategories: [
          'Community Healthcare Programs',
          'Public Health Awareness',
          'Health Camps & Medical Camps',
          'Free Medical Assistance Programs',
          'Patient Welfare Programs',
          'Social Welfare Initiatives',
        ],
      },
      {
        value: 'JOB_ENQUIRY',
        label: 'Job Enquiry / Trust Careers',
        subcategories: ['Social Worker', 'Trust Field Coordinator', 'Community Counselor'],
      },
    ],
    services: [
      {
        name: 'Community Healthcare Programs',
        code: 'UNCF_COMMUNITY_HEALTHCARE',
        subcategory: 'Community Healthcare Programs',
        description: 'Grassroots healthcare initiatives supporting rural and underserved seniors.',
        subServices: ['Rural Clinic Support', 'Preventive Health Checks', 'Community Medical Aid'],
      },
      {
        name: 'Public Health Awareness',
        code: 'UNCF_PUBLIC_HEALTH_AWARENESS',
        subcategory: 'Public Health Awareness',
        description: 'Public health seminars, geriatric lifestyle guidance, and dementia awareness.',
        subServices: ['Geriatric Nutrition Workshop', 'Dementia Care Guidance', 'Preventive Wellness Seminars'],
      },
      {
        name: 'Health Camps & Medical Camps',
        code: 'UNCF_HEALTH_CAMPS',
        subcategory: 'Health Camps & Medical Camps',
        description: 'Free multi-specialty diagnostic and eye/general screening health camps.',
        subServices: ['Free Eye Screening', 'Geriatric Health Camp', 'Diabetes & Hypertension Camp'],
      },
      {
        name: 'Free Medical Assistance Programs',
        code: 'UNCF_FREE_MEDICAL_ASST',
        subcategory: 'Free Medical Assistance Programs',
        description: 'Free consultations, subsidized medicines, and clinical aid for needy elders.',
        subServices: ['Free Medicine Distribution', 'Doctor Visit Subsidy', 'Surgical Aid Assistance'],
      },
      {
        name: 'Patient Welfare Programs',
        code: 'UNCF_PATIENT_WELFARE',
        subcategory: 'Patient Welfare Programs',
        description: 'Holistic welfare programs covering assisted devices and nutrition support.',
        subServices: ['Wheelchair & Walker Distribution', 'Nutritional Supplements', 'Hearing Aid Aid'],
      },
      {
        name: 'Donor Relations & Management',
        code: 'UNCF_DONOR_RELATIONS',
        subcategory: 'Donor Relations & Management',
        description: 'Philanthropic donor care, 80G tax receipt issuing, and donor reporting.',
        subServices: ['80G Tax Exemption Receipts', 'Donor Impact Reports', 'Sponsor Recognition'],
      },
      {
        name: 'Volunteer Management',
        code: 'UNCF_VOLUNTEER_MGMT',
        subcategory: 'Volunteer Management',
        description: 'Volunteer enrollment, field orientation, and companionship scheduling.',
        subServices: ['Youth Volunteer Drives', 'Elder Companionship Visits', 'Event Organizing'],
      },
      {
        name: 'Community Outreach',
        code: 'UNCF_COMMUNITY_OUTREACH',
        subcategory: 'Community Outreach',
        description: 'Direct outreach to old age homes, slums, and village elder councils.',
        subServices: ['Old Age Home Visits', 'Orphanage Healthcare Aid', 'Rural Village Reach'],
      },
      {
        name: 'Social Welfare Initiatives',
        code: 'UNCF_SOCIAL_WELFARE',
        subcategory: 'Social Welfare Initiatives',
        description: 'Advocacy for senior rights, legal protection, and family mediation.',
        subServices: ['Senior Legal Guidance', 'Elder Care Mediation', 'Social Security Aid'],
      },
      {
        name: 'Healthcare Fundraising',
        code: 'UNCF_HEALTHCARE_FUNDRAISING',
        subcategory: 'Healthcare Fundraising',
        description: 'Fundraising campaigns for critical surgeries and subsidized care infrastructure.',
        subServices: ['Crowdfunding Campaigns', 'Corporate CSR Partnerships', 'Charity Galas'],
      },
    ],
  },

  // 3. BUSINESS UNIT 3: ACARE (9 Services)
  {
    key: 'ACARE',
    name: 'Ambulance & Care',
    category: 'Ambulance Logistics & Emergency Dispatch',
    enquiryCategories: [
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Ambulance & Dispatch Services',
        subcategories: [
          'Ambulance Services',
          'Emergency Patient Transportation',
          'Non-Emergency Patient Transportation',
          'Medical Transport Coordination',
          'Emergency Dispatch',
          'Ambulance Booking & Scheduling',
          'Patient Transfer Services',
          'Hospital-to-Hospital Transfers',
          'Medical Escort Coordination',
        ],
      },
      {
        value: 'JOB_ENQUIRY',
        label: 'Job Enquiry / Driver & EMT Careers',
        subcategories: ['Ambulance Driver', 'Emergency Medical Technician (EMT)', 'Paramedic'],
      },
      {
        value: 'COMPLAINT_OR_SUPPORT',
        label: 'Complaint / Fleet Support',
        subcategories: ['Dispatch Delay Feedback', 'Billing Dispute', 'Staff Conduct'],
      },
    ],
    services: [
      {
        name: 'Ambulance Services',
        code: 'ACARE_AMBULANCE_SERVICES',
        subcategory: 'Ambulance Services',
        isEmergency: true,
        description: '24/7 dedicated fleet of Basic (BLS) and Advanced (ALS) life support ambulances.',
        subServices: ['Basic Life Support (BLS)', 'Advanced Cardiac Life Support (ACLS)', 'Patient Transport Vehicle (PTV)'],
      },
      {
        name: 'Emergency Patient Transportation',
        code: 'ACARE_EMERGENCY_TRANSPORT',
        subcategory: 'Emergency Patient Transportation',
        isEmergency: true,
        description: 'Rapid response emergency transit with on-board paramedic and oxygen support.',
        subServices: ['Cardiac Emergency Run', 'Trauma Resuscitation Transport', 'Critical ICU Ambulance'],
      },
      {
        name: 'Non-Emergency Patient Transportation',
        code: 'ACARE_NON_EMERGENCY_TRANSPORT',
        subcategory: 'Non-Emergency Patient Transportation',
        description: 'Scheduled transit for elderly checkups, dialysis, chemo, and physiotherapy.',
        subServices: ['Dialysis Round-Trip', 'Chemotherapy OPD Transit', 'Physiotherapy Center Transfer'],
      },
      {
        name: 'Medical Transport Coordination',
        code: 'ACARE_MED_TRANSPORT_COORD',
        subcategory: 'Medical Transport Coordination',
        description: 'Route optimization, fleet telemetry, GPS vehicle dispatch, and timing coordination.',
        subServices: ['Real-Time Fleet Telemetry', 'Route Traffic Optimization', 'Hospital Arrival Notification'],
      },
      {
        name: 'Emergency Dispatch',
        code: 'ACARE_EMERGENCY_DISPATCH',
        subcategory: 'Emergency Dispatch',
        isEmergency: true,
        description: 'Immediate priority triage and closest ambulance dispatch within 3 minutes.',
        subServices: ['Priority Call Intake', 'Driver & EMT Auto-Alert', 'Nearest Fleet Re-routing'],
      },
      {
        name: 'Ambulance Booking & Scheduling',
        code: 'ACARE_AMBULANCE_BOOKING',
        subcategory: 'Ambulance Booking & Scheduling',
        description: 'Advance reservations for planned patient transfers and airport pickups.',
        subServices: ['Planned Advance Booking', 'Recurring Transport Package', 'Airport Medical Pickup'],
      },
      {
        name: 'Patient Transfer Services',
        code: 'ACARE_PATIENT_TRANSFER',
        subcategory: 'Patient Transfer Services',
        description: 'Bed-to-bed gentle transfers between residences, rehabilitation centers, and care homes.',
        subServices: ['Bed-to-Bed Transfer', 'Stretcher Mobility Transit', 'Wheelchair Lift Ambulance'],
      },
      {
        name: 'Hospital-to-Hospital Transfers',
        code: 'ACARE_HOSPITAL_TRANSFER',
        subcategory: 'Hospital-to-Hospital Transfers',
        description: 'Inter-facility transfer of ICU patients with ventilator and specialized doctors.',
        subServices: ['Ventilator-Assisted Transfer', 'Tertiary Center Referral', 'Doctor Escorted Transport'],
      },
      {
        name: 'Medical Escort Coordination',
        code: 'ACARE_MED_ESCORT_COORD',
        subcategory: 'Medical Escort Coordination',
        description: 'Trained medical personnel accompanying elderly clients on domestic travel.',
        subServices: ['Flight Paramedic Escort', 'Inter-City Train Medical Attendant', 'Personal Ambulance Nurse'],
      },
    ],
  },

  // 4. BUSINESS UNIT 4: HOME_CARE (12 Services)
  {
    key: 'HOME_CARE',
    name: 'Home Care Services',
    category: 'Domiciliary Healthcare & In-Home Assisted Living',
    enquiryCategories: [
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Home Care Service Enquiry',
        subcategories: [
          'In-Home Nursing Care',
          'Elderly Home Care',
          'Patient Attendant Services',
          'Personal Care Assistance',
          'Daily Living Assistance',
          'Bedridden Patient Care',
          'Post-Surgical Home Care',
          'Physiotherapy at Home',
          'Medication & Health Monitoring',
          'Palliative Care Support',
          'Home Healthcare Visits',
          'Long-Term Home Care',
        ],
      },
      {
        value: 'JOB_ENQUIRY',
        label: 'Job Enquiry / Home Care Careers',
        subcategories: ['Home Nurse (ANM/GNM)', 'Bedside Caregiver', 'Visiting Physiotherapist'],
      },
      {
        value: 'COMPLAINT_OR_SUPPORT',
        label: 'Caregiver Support / Feedback',
        subcategories: ['Caregiver Replacement Request', 'Timing Adjustment', 'Care Delivery Feedback'],
      },
    ],
    services: [
      {
        name: 'In-Home Nursing Care',
        code: 'HOME_IN_HOME_NURSING',
        subcategory: 'In-Home Nursing Care',
        description: 'Professional certified nursing care provided directly in the patient home.',
        subServices: ['12/24-Hr Nurse Shift', 'Injections & Infusion Care', 'Tracheostomy & Catheter Care'],
      },
      {
        name: 'Elderly Home Care',
        code: 'HOME_ELDERLY_HOME_CARE',
        subcategory: 'Elderly Home Care',
        description: 'Dedicated geriatric companion care ensuring comfort, companionship, and safety.',
        subServices: ['Companionship & Conversation', 'Cognitive Stimulation Games', 'Fall Prevention & Safety'],
      },
      {
        name: 'Patient Attendant Services',
        code: 'HOME_PATIENT_ATTENDANT',
        subcategory: 'Patient Attendant Services',
        description: 'Trained semi-clinical bedside attendants assisting with physical transfers and hygiene.',
        subServices: ['Bedside Attendant (Day/Night)', 'Mobility Support', 'Bed Positioning'],
      },
      {
        name: 'Personal Care Assistance',
        code: 'HOME_PERSONAL_CARE_ASST',
        subcategory: 'Personal Care Assistance',
        description: 'Dignified assistance with sponge baths, grooming, toileting, and dressing.',
        subServices: ['Bed Sponge Bathing', 'Oral Hygiene & Grooming', 'Diaper Changing & Incontinence Care'],
      },
      {
        name: 'Daily Living Assistance',
        code: 'HOME_DAILY_LIVING_ASST',
        subcategory: 'Daily Living Assistance',
        description: 'Assisting seniors with feeding, walking, light errands, and daily scheduling.',
        subServices: ['Assisted Feeding', 'Walking Support', 'Routine Daily Scheduling'],
      },
      {
        name: 'Bedridden Patient Care',
        code: 'HOME_BEDRIDDEN_PATIENT_CARE',
        subcategory: 'Bedridden Patient Care',
        description: 'Specialized 24-hr care for non-ambulatory patients with air mattress and position rotation.',
        subServices: ['2-Hourly Turning & Pressure Relief', 'Ryle\'s Tube / PEG Feeding', 'Air Bed Maintenance'],
      },
      {
        name: 'Post-Surgical Home Care',
        code: 'HOME_POST_SURGICAL_HOME_CARE',
        subcategory: 'Post-Surgical Home Care',
        description: 'Post-discharge rehabilitation, surgical drain monitoring, and stitch care.',
        subServices: ['Surgical Wound Dressing', 'Post-Op Vital Monitoring', 'Drain Output Charting'],
      },
      {
        name: 'Physiotherapy at Home',
        code: 'HOME_PHYSIOTHERAPY_HOME',
        subcategory: 'Physiotherapy at Home',
        description: 'Licensed physical therapists conducting neuro, ortho, and chest physiotherapy at home.',
        subServices: ['Stroke Rehabilitation', 'Joint Replacement Physio', 'Chest Physio & Breathing Exercises'],
      },
      {
        name: 'Medication & Health Monitoring',
        code: 'HOME_MED_HEALTH_MONITORING',
        subcategory: 'Medication & Health Monitoring',
        description: 'Strict adherence to doctor prescriptions, pill sorting, and sugar/pressure logs.',
        subServices: ['Pill Organizer Management', 'Daily BP/Sugar Logging', 'Doctor Escalation Protocol'],
      },
      {
        name: 'Palliative Care Support',
        code: 'HOME_PALLIATIVE_CARE_SUPPORT',
        subcategory: 'Palliative Care Support',
        description: 'Compassionate symptom relief, pain management, and dignity preservation at home.',
        subServices: ['Pain Relief Administration', 'Emotional & Family Counseling', 'End-of-Life Comfort Protocol'],
      },
      {
        name: 'Home Healthcare Visits',
        code: 'HOME_HEALTHCARE_VISITS',
        subcategory: 'Home Healthcare Visits',
        description: 'On-demand visits by general physicians, clinical psychologists, and phlebotomists.',
        subServices: ['Doctor Home Visit', 'Home Blood Sample Collection', 'ECG at Home'],
      },
      {
        name: 'Long-Term Home Care',
        code: 'HOME_LONG_TERM_HOME_CARE',
        subcategory: 'Long-Term Home Care',
        description: 'Comprehensive month-to-month contracts for chronic illness and Alzheimer care.',
        subServices: ['Monthly Caregiver Package', 'Supervised Care Audit', 'Monthly Family Progress Review'],
      },
    ],
  },
];

export const CARE_CONFIG = {
  categories: [
    { value: 'SERVICE_ENQUIRY', label: 'Service Enquiry' },
    { value: 'JOB_ENQUIRY', label: 'Job Enquiry / Careers' },
    { value: 'VOLUNTEER_ENQUIRY', label: 'Volunteer Enquiry' },
    { value: 'DONOR_ENQUIRY', label: 'Donor Enquiry' },
    { value: 'GENERAL_ENQUIRY', label: 'General Enquiry' },
    { value: 'COMPLAINT_OR_SUPPORT', label: 'Complaint / Support' },
  ],
};
