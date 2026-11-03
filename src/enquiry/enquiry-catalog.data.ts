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
  { key: 'UEC', name: 'UEC', label: 'UEC' },
  { key: 'UNCF', name: 'UNCF', label: 'UNCF' },
  { key: 'ACARE', name: 'ACare', label: 'ACare' },
];

export const INITIAL_FOUNDATIONS: FoundationCatalogDefinition[] = [
  {
    key: 'UEC',
    name: 'UEC',
    category: 'Care & Residential Intake',
    enquiryCategories: [
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Service Enquiry',
        subcategories: [
          'Assisted Living',
          'Memory & Dementia',
          'Rehabilitation & Post-Op',
          'Palliative & Bedridden Care',
          'Geriatric Residential Care',
          'Other Care',
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
        name: 'Assisted Living',
        code: 'UEC_ASSISTED_LIVING',
        subcategory: 'Assisted Living',
        description: 'Assisted living services for seniors needing personal care support.',
        subServices: ['Daily Living Assistance', 'Medication Management', 'Meal Support', 'Personal Hygiene'],
      },
      {
        name: 'Dementia / Alzheimer\'s Care',
        code: 'UEC_DEMENTIA_CARE',
        subcategory: 'Memory & Dementia',
        description: 'Specialized memory care and cognitive stimulation therapy.',
        subServices: ['Memory Care Unit', 'Wandering Prevention', 'Cognitive Activities', '24/7 Attendant Support'],
      },
      {
        name: 'Post-operative Care',
        code: 'UEC_POST_OPERATIVE',
        subcategory: 'Rehabilitation & Post-Op',
        description: 'Short and long term post-surgical recovery care and rehabilitation.',
        subServices: ['Wound Dressing', 'Post-Op Monitoring', 'Pain Management', 'Rehabilitation Mobility'],
      },
      {
        name: 'Palliative Care',
        code: 'UEC_PALLIATIVE_CARE',
        subcategory: 'Palliative & Bedridden Care',
        description: 'Compassionate comfort and symptom management care for chronic/terminal conditions.',
        subServices: ['Pain & Symptom Relief', 'Emotional & Family Support', 'Doctor Consultations', 'Comfort Nursing'],
      },
      {
        name: 'Bedridden Patient Care',
        code: 'UEC_BEDRIDDEN_CARE',
        subcategory: 'Palliative & Bedridden Care',
        description: 'Comprehensive 24/7 bedside nursing and hygiene care for non-ambulatory patients.',
        subServices: ['Position Changing / Q2H Turning', 'Catheter & Ryle\'s Tube Care', 'Bed Bath & Grooming', 'Vitals Monitoring'],
      },
      {
        name: 'Bed Sore / Pressure Injury Care',
        code: 'UEC_PRESSURE_INJURY_CARE',
        subcategory: 'Palliative & Bedridden Care',
        description: 'Specialized stage 1-4 pressure ulcer management and prevention.',
        subServices: ['Air Mattress Setup', 'Debridement & Advanced Dressing', 'Nutritional Support', 'Skin Integrity Assessment'],
      },
      {
        name: 'Geriatric Residential Care',
        code: 'UEC_GERIATRIC_RESIDENTIAL_CARE',
        subcategory: 'Geriatric Residential Care',
        description: 'Inpatient geriatric residential care and specialized daily assisted living (approved replacement for legacy home care).',
        subServices: ['24-Hour Live-in Caregiver', 'Visiting Physician', 'Daily Attendant Care', 'Medication Management'],
      },
      {
        name: 'Other Care Requirements',
        code: 'UEC_OTHER_CARE',
        subcategory: 'Other Care',
        description: 'Custom care plans tailored to individual client and family requirements.',
        subServices: ['Custom Care Plan', 'Short Respite Stay', 'Specialized Diet & Physical Therapy'],
      },
    ],
  },
  {
    key: 'UNCF',
    name: 'UNCF',
    category: 'Community Welfare & Healthcare Trust',
    enquiryCategories: [
      {
        value: 'DONOR_ENQUIRY',
        label: 'Donor Enquiry',
        subcategories: ['CSR Partnership', 'Individual Donation', 'Patient Subsidy Sponsorship', 'Equipment Donation'],
      },
      {
        value: 'VOLUNTEER_ENQUIRY',
        label: 'Volunteer Enquiry',
        subcategories: ['Elder Companionship', 'Medical Camp Volunteer', 'Community Outreach'],
      },
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Service Enquiry',
        subcategories: ['Subsidized Healthcare Support', 'Free Health Screenings', 'Community Relief Aid'],
      },
      {
        value: 'JOB_ENQUIRY',
        label: 'Job Enquiry / Careers',
        subcategories: ['Social Worker', 'Trust Field Coordinator', 'Community Counselor'],
      },
      {
        value: 'GENERAL_ENQUIRY',
        label: 'General Enquiry',
        subcategories: ['Trust Information', 'Audit & Transparency', 'Program Overview'],
      },
    ],
    services: [
      {
        name: 'Subsidized Elder Care Support',
        code: 'UNCF_SUBSIDIZED_CARE',
        subcategory: 'Subsidized Healthcare Support',
        description: 'Subsidized clinical and daily living support for economically disadvantaged seniors.',
        subServices: ['Financial Aid Assessment', 'Sponsored Bed Allocation', 'Subsidized Nursing'],
      },
      {
        name: 'Free Geriatric Medical Camps & Screenings',
        code: 'UNCF_MEDICAL_CAMPS',
        subcategory: 'Free Health Screenings',
        description: 'Periodic community medical camps providing free doctor consultations and basic screenings.',
        subServices: ['General Physician Screening', 'Eye & Hearing Camp', 'Free Basic Medication'],
      },
      {
        name: 'Community Aid & Emergency Relief',
        code: 'UNCF_COMMUNITY_AID',
        subcategory: 'Community Relief Aid',
        description: 'Community emergency assistance, ration supplies, and urgent relief for destitute seniors.',
        subServices: ['Emergency Relief Distribution', 'Medical Ration Support', 'Crisis Intervention'],
      },
      {
        name: 'Donor & CSR Sponsorship Coordination',
        code: 'UNCF_DONOR_CSR',
        subcategory: 'CSR Partnership',
        description: 'Corporate Social Responsibility engagement and structured philanthropic donations.',
        subServices: ['CSR MoUs', 'Tax Exemption 80G Receipts', 'Impact Reporting'],
      },
      {
        name: 'Volunteer Engagement Program',
        code: 'UNCF_VOLUNTEER_PROGRAM',
        subcategory: 'Elder Companionship',
        description: 'Programs linking young volunteers and students with elderly individuals for companionship.',
        subServices: ['Weekend Companionship', 'Digital Literacy for Seniors', 'Recreational Activities'],
      },
    ],
  },
  {
    key: 'ACARE',
    name: 'ACare',
    category: 'Home & Support Services',
    enquiryCategories: [
      {
        value: 'SERVICE_ENQUIRY',
        label: 'Service Enquiry',
        subcategories: [
          'Clinical Visits at Home',
          'Home Nursing',
          'Caregiver & Attendant',
          'Medical Equipment Rental',
          'Emergency Ambulance',
          'Ayurveda & Therapy',
          'Diagnostics & Medicine',
        ],
      },
      {
        value: 'JOB_ENQUIRY',
        label: 'Job Enquiry / Careers',
        subcategories: ['Home Nurse (ANM/GNM)', 'Bedside Attendant', 'Physiotherapist', 'Ambulance Driver / EMT'],
      },
      {
        value: 'GENERAL_ENQUIRY',
        label: 'General Enquiry',
        subcategories: ['Service Rates & Quotation', 'Equipment Availability', 'Service Areas / Coverage'],
      },
      {
        value: 'COMPLAINT_OR_SUPPORT',
        label: 'Complaint / Support',
        subcategories: ['Caregiver Attendance Issue', 'Replacement Request', 'Equipment Fault / Service'],
      },
    ],
    services: [
      { name: 'Doctor at Home', code: 'ACARE_DOCTOR_HOME', subcategory: 'Clinical Visits at Home', subServices: ['General Physician Visit', 'Geriatric Specialist Visit', 'Tele-consult Follow-up'] },
      { name: 'Nursing Care at Home', code: 'ACARE_NURSING_HOME', subcategory: 'Home Nursing', subServices: ['IV / IM Injections', 'Catheterization', 'Dressing / Wound Care', 'Tracheostomy Care'] },
      { name: 'Care Support at Home', code: 'ACARE_CARE_HOME', subcategory: 'Caregiver & Attendant', subServices: ['Bedside Attendant', 'Companion Care', 'Hygiene & Feeding Assistance'] },
      { name: 'Baby Care at Home', code: 'ACARE_BABY_CARE_HOME', subcategory: 'Caregiver & Attendant', subServices: ['Newborn Care Specialist', 'Post-Natal Mother Support', 'Lactation Assistance'] },
      { name: 'ICU Setup & Ryle\'s Tube Feeding at Home', code: 'ACARE_ICU_SETUP_HOME', subcategory: 'Home Nursing', subServices: ['Home ICU Ventilator Setup', 'Ryle\'s Tube Insertion & Feeding', 'Infusion Pump Setup', 'Critical Care Nurse'] },
      { name: 'Physiotherapy at Home', code: 'ACARE_PHYSIO_HOME', subcategory: 'Ayurveda & Therapy', subServices: ['Orthopedic Rehabilitation', 'Stroke Recovery Physio', 'Chest Physiotherapy', 'Geriatric Mobility'] },
      { name: 'Ayurveda Therapy & Pain Management', code: 'ACARE_AYURVEDA_HOME', subcategory: 'Ayurveda & Therapy', subServices: ['Abhyanga / Panchakarma Massage', 'Kizhi Therapy', 'Joint Pain Management', 'Herbal Steam Setup'] },
      { name: 'Diagnostics at Home', code: 'ACARE_DIAGNOSTICS_HOME', subcategory: 'Diagnostics & Medicine', subServices: ['Blood Sample Collection', 'Home ECG', 'Holter Monitor Setup', 'Portable X-Ray'] },
      { name: 'Medicine Delivery at Home', code: 'ACARE_MEDICINE_DELIVERY', subcategory: 'Diagnostics & Medicine', subServices: ['Monthly Chronic Meds Refill', 'Emergency Prescription Delivery', 'Cold-Chain Insulin/Biologicals'] },
      { name: 'Wound Care at Home', code: 'ACARE_WOUND_CARE_HOME', subcategory: 'Home Nursing', subServices: ['Diabetic Foot Ulcer Care', 'Surgical Wound Dressing', 'Vacuum-Assisted Closure (VAC)'] },
      { name: 'Medical & Surgical Equipment — Rental & Purchase', code: 'ACARE_EQUIPMENT', subcategory: 'Medical Equipment Rental', subServices: ['Hospital Bed (Manual/Motorized)', 'Oxygen Concentrator', 'BiPAP / CPAP Machine', 'Suction Machine', 'Wheelchair Rental'] },
      { name: 'Ambulance Services', code: 'ACARE_AMBULANCE', isEmergency: true, subcategory: 'Emergency Ambulance', subServices: ['Emergency Cardiac Ambulance', 'Basic Life Support (BLS)', 'Advance Life Support (ALS)', 'Patient Transport'] },
      { name: 'Errand & Support Services', code: 'ACARE_ERRAND_SUPPORT', subcategory: 'Caregiver & Attendant', subServices: ['Hospital Companion / Escort', 'Banking & Pharmacy Errands', 'Grocery Delivery Support'] },
      { name: 'Funeral & Last Rites Assistance Services', code: 'ACARE_FUNERAL_LAST_RITES', subcategory: 'Caregiver & Attendant', subServices: ['Freezer Box Provision', 'Hearse Van Service', 'Cremation / Burial Coordination', 'Priest & Ritual Arrangement'] },
    ],
  },
];

export const CARE_CONFIG = {
  engagementTypes: [
    'One-time Care',
    'Regular Daily Care',
    'Day Care / Day Scholar',
    'Residential Care',
    'Shift-based Care',
  ],
  durationCategories: [
    { id: 'DAY_CARE', label: 'Day Care (Single day / day-scholar)' },
    { id: 'SHORT_TERM', label: 'Short-term Care (Up to 30 days)' },
    { id: 'LONG_TERM', label: 'Long-term Care (Beyond 30 days)' },
  ],
  shortTermDurations: [
    '1 day',
    '2 days',
    '3 days',
    '4 days',
    '5 days',
    '6 days',
    '7 days',
    '14 days',
    '21 days',
    '30 days',
    'Other specified duration',
  ],
  longTermDurations: [
    '1 month',
    '3 months',
    '6 months',
    '10 months',
    '12 months',
    'Other specified duration',
    'Custom contract duration',
  ],
  careSchedules: [
    '12-hour care (Day shift: 8 AM - 8 PM)',
    '12-hour care (Night shift: 8 PM - 8 AM)',
    '24-hour care (Full-day live-in)',
    'Custom shift',
    'Daytime schedule',
    'Night-time schedule',
    'Custom schedule',
  ],
  mobilityOptions: [
    'Fully Independent',
    'Needs Partial Assistance (Walker / Cane)',
    'Wheelchair Bound',
    'Bedridden (Requires Complete Assistance)',
  ],
  enquiryCategories: [
    { value: 'SERVICE_ENQUIRY', label: 'Service Enquiry' },
    { value: 'JOB_ENQUIRY', label: 'Job Enquiry / Careers' },
    { value: 'VOLUNTEER_ENQUIRY', label: 'Volunteer Enquiry' },
    { value: 'DONOR_ENQUIRY', label: 'Donor Enquiry' },
    { value: 'GENERAL_ENQUIRY', label: 'General Enquiry' },
    { value: 'COMPLAINT_OR_SUPPORT', label: 'Complaint / Support' },
  ],
};
