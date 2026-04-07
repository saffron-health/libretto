export type ToolStep = {
  label: string;
  durationMs: number;
};

export type WorkflowExample = {
  id: string;
  tab: string;
  userMessage: string;
  thinkDurationMs: number;
  tools: ToolStep[];
  agentResponse: string;
};

export const workflowExamples: WorkflowExample[] = [
  {
    id: "craigslist",
    tab: "Craigslist",
    userMessage:
      "Use the Libretto skill. Go on Craigslist and scrape the first 10 two-bedroom apartment listings for title, price, location, and link.",
    thinkDurationMs: 1800,
    tools: [
      {
        label: "bash: npx libretto open https://craigslist.org --headed",
        durationMs: 1400,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Find 2BR apartment listings"',
        durationMs: 1200,
      },
      {
        label: 'bash: npx libretto exec "await page.locator(…).click()"',
        durationMs: 900,
      },
      {
        label:
          "bash: npx libretto exec \"return await page.locator('.cl-static-search-result').first().textContent()\"",
        durationMs: 800,
      },
      {
        label: "write: craigslist_2br_apartments.ts",
        durationMs: 1000,
      },
    ],
    agentResponse:
      "Created craigslist_2br_apartments.ts — a workflow that opens Craigslist, navigates to 2BR apartment listings, and scrapes the first 10 for title, price, location, and link.\n\nRun it anytime:\n  npx libretto run ./craigslist_2br_apartments.ts main --headless",
  },
  {
    id: "linkedin",
    tab: "LinkedIn",
    userMessage:
      "Use the Libretto skill. Go to LinkedIn and triage my pending connection requests — accept requests from people in healthcare or tech, and ignore the rest.",
    thinkDurationMs: 2000,
    tools: [
      {
        label: "bash: npx libretto open https://linkedin.com --headed",
        durationMs: 1600,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Find pending connection requests"',
        durationMs: 1400,
      },
      {
        label:
          'bash: npx libretto exec "await page.goto(\'https://www.linkedin.com/mynetwork/invitation-manager/\')"',
        durationMs: 1100,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "List all pending invitations with name, headline, and mutual connections"',
        durationMs: 1200,
      },
      {
        label:
          'bash: npx libretto exec "return await page.locator(\'.invitation-card\').all()"',
        durationMs: 900,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(…acceptBtn).click()"',
        durationMs: 800,
      },
      {
        label: "write: linkedin_triage_connections.ts",
        durationMs: 1000,
      },
    ],
    agentResponse:
      "Created linkedin_triage_connections.ts — a workflow that opens LinkedIn, reads each pending connection request's headline and industry, accepts healthcare/tech connections, and ignores the rest.\n\nRun it anytime:\n  npx libretto run ./linkedin_triage_connections.ts main --headed",
  },
  {
    id: "eclinicalworks",
    tab: "eClinicalWorks",
    userMessage:
      "Use the Libretto skill. Log into eClinicalWorks, search for a patient by name and date of birth, and pull their insurance information including payer, member ID, group number, and coverage dates.",
    thinkDurationMs: 2200,
    tools: [
      {
        label: "bash: npx libretto open https://eclinicalworks.com --headed",
        durationMs: 1800,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Find the login form"',
        durationMs: 1000,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'#searchPatient\').fill(input.patientName)"',
        durationMs: 900,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Locate insurance tab in patient chart"',
        durationMs: 1300,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'[data-tab=insurance]\').click()"',
        durationMs: 800,
      },
      {
        label:
          'bash: npx libretto exec "return await page.locator(\'.insurance-detail\').textContent()"',
        durationMs: 1000,
      },
      {
        label: "write: ecw_patient_insurance.ts",
        durationMs: 1000,
      },
    ],
    agentResponse:
      "Created ecw_patient_insurance.ts — a workflow that logs into eClinicalWorks, searches for a patient by name and date of birth, navigates to their insurance tab, and extracts payer name, member ID, group number, and coverage dates.\n\nRun it anytime:\n  npx libretto run ./ecw_patient_insurance.ts main --headed",
  },
  {
    id: "uhc",
    tab: "UnitedHealthcare",
    userMessage:
      "Use the Libretto skill. Log into the UnitedHealthcare provider portal and review a submitted claim by claim number — pull back the status, paid amount, patient responsibility, and any denial codes.",
    thinkDurationMs: 2000,
    tools: [
      {
        label:
          "bash: npx libretto open https://uhcprovider.com --headed",
        durationMs: 1700,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Find the claim search form"',
        durationMs: 1200,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'#claimNumber\').fill(input.claimNumber)"',
        durationMs: 800,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'button:has-text(\"Search\")\').click()"',
        durationMs: 900,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Extract claim status, payment details, and denial codes"',
        durationMs: 1400,
      },
      {
        label:
          'bash: npx libretto exec "return await page.locator(\'.claim-summary\').textContent()"',
        durationMs: 1000,
      },
      {
        label: "write: uhc_claim_review.ts",
        durationMs: 1000,
      },
    ],
    agentResponse:
      "Created uhc_claim_review.ts — a workflow that logs into the UHC provider portal, searches for a claim by number, and extracts the status, paid amount, patient responsibility, and any denial codes.\n\nRun it anytime:\n  npx libretto run ./uhc_claim_review.ts main --headed",
  },
  {
    id: "availity",
    tab: "Availity",
    userMessage:
      "Use the Libretto skill. Log into Availity and fill out a prior authorization request for a specialist referral — enter the patient info, referring provider, specialist details, diagnosis codes, and submit.",
    thinkDurationMs: 2200,
    tools: [
      {
        label: "bash: npx libretto open https://availity.com --headed",
        durationMs: 1800,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Find the authorizations section"',
        durationMs: 1200,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'a:has-text(\"Authorizations & Referrals\")\').click()"',
        durationMs: 900,
      },
      {
        label:
          'bash: npx libretto snapshot --objective "Map out the prior auth form fields"',
        durationMs: 1400,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'#memberId\').fill(input.memberId)"',
        durationMs: 700,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'#diagnosisCode\').fill(input.diagnosisCode)"',
        durationMs: 700,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'#referringProvider\').fill(input.referringNPI)"',
        durationMs: 700,
      },
      {
        label:
          'bash: npx libretto exec "await page.locator(\'button:has-text(\"Submit\")\').click()"',
        durationMs: 900,
      },
      {
        label: "write: availity_prior_auth.ts",
        durationMs: 1000,
      },
    ],
    agentResponse:
      "Created availity_prior_auth.ts — a workflow that logs into Availity, navigates to Authorizations & Referrals, fills out a prior auth form with patient info, provider details, and diagnosis codes, then submits.\n\nRun it anytime:\n  npx libretto run ./availity_prior_auth.ts main --headed",
  },
];
