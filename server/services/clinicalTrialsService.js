const axios = require('axios');
const { CLINICAL_TRIALS_BASE, CLINICAL_TRIALS_PAGE_SIZE } = require('../config/constants');

class ClinicalTrialsService {
  /**
   * Fetch clinical trials from ClinicalTrials.gov API v2
   */
  async fetchTrials(disease, intent = '', location = '') {
    const allTrials = [];

    const statusGroups = [
      'RECRUITING',
      'ACTIVE_NOT_RECRUITING',
      'COMPLETED'
    ];

    const fetchPromises = statusGroups.map(status => {
      const params = {
        'query.cond': disease,
        'filter.overallStatus': status,
        pageSize: CLINICAL_TRIALS_PAGE_SIZE,
        format: 'json'
      };

      if (intent && intent.toLowerCase() !== disease.toLowerCase()) {
        params['query.term'] = intent;
      }

      return axios.get(CLINICAL_TRIALS_BASE, {
        params,
        timeout: 10000
      }).then(response => {
        if (response.data?.studies) {
          return response.data.studies.map(study => this._parseStudy(study));
        }
        return [];
      }).catch(error => {
        console.error(`ClinicalTrials fetch error (status: ${status}):`, error.message);
        return [];
      });
    });

    const unflatTrials = await Promise.all(fetchPromises);
    allTrials.push(...unflatTrials.flat());

    console.log(`🧪 ClinicalTrials.gov: Retrieved ${allTrials.length} trials`);
    return this._deduplicate(allTrials);
  }

  /**
   * Parse a ClinicalTrials.gov study into our unified format
   */
  _parseStudy(study) {
    const protocol = study.protocolSection || {};
    const id = protocol.identificationModule || {};
    const status = protocol.statusModule || {};
    const description = protocol.descriptionModule || {};
    const eligibility = protocol.eligibilityModule || {};
    const contacts = protocol.contactsLocationsModule || {};
    const design = protocol.designModule || {};

    // Extract locations
    const locations = (contacts.locations || []).map(loc => {
      const parts = [loc.facility, loc.city, loc.state, loc.country].filter(Boolean);
      return parts.join(', ');
    });

    // Extract contact info
    const centralContacts = (contacts.centralContacts || []).map(c => {
      return [c.name, c.email, c.phone].filter(Boolean).join(' | ');
    });

    // Extract phases
    const phases = (design.phases || []).join(', ') || 'N/A';

    // Extract conditions
    const conditions = protocol.conditionsModule?.conditions || [];

    return {
      nctId: id.nctId || '',
      title: id.briefTitle || id.officialTitle || 'Untitled Trial',
      officialTitle: id.officialTitle || '',
      status: status.overallStatus || 'UNKNOWN',
      summary: description.briefSummary || '',
      detailedDescription: (description.detailedDescription || '').substring(0, 500),
      eligibility: eligibility.eligibilityCriteria || '',
      eligibilitySex: eligibility.sex || 'ALL',
      eligibilityMinAge: eligibility.minimumAge || '',
      eligibilityMaxAge: eligibility.maximumAge || '',
      location: locations.join(' | ') || 'Location not specified',
      locations: locations,
      contact: centralContacts.join(' ; ') || 'Contact not available',
      phase: phases,
      conditions,
      sponsor: protocol.sponsorCollaboratorsModule?.leadSponsor?.name || '',
      startDate: status.startDateStruct?.date || '',
      completionDate: status.completionDateStruct?.date || '',
      enrollmentCount: design.enrollmentInfo?.count || 0,
      url: `https://clinicaltrials.gov/study/${id.nctId}`,
      source: 'ClinicalTrials.gov'
    };
  }

  /**
   * Deduplicate by NCT ID
   */
  _deduplicate(trials) {
    const seen = new Set();
    return trials.filter(t => {
      if (seen.has(t.nctId)) return false;
      seen.add(t.nctId);
      return true;
    });
  }
}

module.exports = new ClinicalTrialsService();
