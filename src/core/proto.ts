// Single source of truth on the hh protocol (confirmed by live experiments,
// see docs/hh.md §1-5). Any change on the hh side is patched here.

export const PROTO = {
  // Test catalog (section list), SSR page on spb.hh.ru
  catalog: {
    path: '/applicant/skill_verifications/methods',
    ssrTemplateClass: 'SkillsFront-InitialState',
    ssrKey: 'skillsVerificationMethodsPage.items',
    // Section page (level/kind selection): /<skillId> and query rank/kind
    sectionPath: '/applicant/skills/<skillId>/verification_methods'
  },

  // Test start: redirect with fingerprint params (docs/hh.md §3, §3.1)
  start: {
    path: '/skills/applicant/keyskills/verification_methods/redirect_to_test',
    hhtmFrom: 'skill_assessment_current',
    // Value from a live capture; may be 'langs' for language sections
    skillCategory: 'skills'
  },

  // Assessment API (docs/hh.md §4). All paths are relative to origin assessment.hh.ru
  assessment: {
    base: 'https://assessment.hh.ru',
    paths: {
      getCurrentTask: '/shards/cert_tests/get_current_task',
      getContestTasks: '/shards/contest/get_contest_tasks',
      getTimeLeft: '/shards/contest/get_time_left',
      submitAnswer: '/shards/cert_tests/submit_user_answer',
      postFinish: '/shards/contest/post_finish'
    },
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      'X-Hhtmsource': 'CertTests'
    }
  },

  // Code tests (practice), docs/hh.md §4.1. Separate cert_code contour:
  // page assessment.hh.ru/code/<skillId>, header X-Hhtmsource: CertCode.
  code: {
    pagePath: '/code/<skillId>',
    ssrTemplateClass: 'AssessmentFront-InitialState',
    ssrKey: 'pageCertCode',
    paths: {
      updateCode: '/shards/cert_code/update_code',
      submitTask: '/shards/cert_code/post_submit_task',
      getSubmitTaskResult: '/shards/cert_code/get_submit_task_result',
      resetCode: '/shards/cert_code/reset_code'
    },
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      'X-Hhtmsource': 'CertCode'
    },
    // Code in the post_submit_task body: UTF-8 → base64 (bundle module 16677).
    // post_submit_task trims the code before encoding; update_code doesn't.
    submissionTypes: { check: 'check', full: 'full' },
    // Solution-loop limits
    maxFixAttempts: 5, // 1st run + up to 5 fixes on the results
    pollAttempts: 10, // result polling
    pollDelayMs: 2000
  },

  // report_data telemetry (docs/hh.md §5)
  telemetry: {
    heartbeatMs: 20000,
    types: {
      windowFocus: 1,
      windowResized: 2,
      codePasted: 3,
      codeCopied: 4,
      codeEdited: 5,
      textCopied: 6,
      questionCopied: 7,
      chooseAnswer: 8,
      failedToDetect: 9,
      heartBeat: 10
    }
  },

  // FingerprintJS component paths for the three hashes (docs/hh.md §3.1, function W)
  fingerprint: {
    strictPaths: [
      'canvas.value.geometry',
      'canvas.value.text',
      'webGlBasics.value.rendererUnmasked',
      'webGlBasics.value.vendorUnmasked',
      'webGlExtensions.value.extensions',
      'plugins.value',
      'fonts.value',
      'screenResolution.value',
      'colorDepth.value',
      'deviceMemory.value',
      'hardwareConcurrency.value',
      'math.value',
      'audio.value'
    ],
    softPaths: [
      'canvas.value.geometry',
      'webGlBasics.value.rendererUnmasked',
      'webGlBasics.value.vendorUnmasked',
      'webGlExtensions.value.extensions',
      'fontPreferences.value',
      'screenResolution.value',
      'colorDepth.value',
      'deviceMemory.value',
      'hardwareConcurrency.value'
    ],
    hardwarePaths: [
      'webGlBasics.value.rendererUnmasked',
      'webGlBasics.value.vendorUnmasked',
      'deviceMemory.value',
      'hardwareConcurrency.value',
      'screenResolution.value'
    ]
  }
} as const;
