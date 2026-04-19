const {
  findPreviousOutputByKey
} = require('../skill-utils');
const {
  tavily
} = require('@tavily/core');
const {
  config
} = require('../config');
const DEFAULT_SEARCH_RESUT_COUNT = 5;
const MAX_SEARCH_RESUT_COUNT = 20;
module.exports = {
  stepName: 'search_web',
  requiresAI: false,
  payloadDefinition: {
    query: 'The search query text.',
    max_result_count: 'The max search result count specified by the task.'
  },
  description: 'Get internet search result. e.g.: "Search the most popular songs in the world and get the first 10 result", the query is "the most popular songs" and max_result_count is "10".',
  execute: async (context, services, stepDefinition) => {
    const query = stepDefinition.payload && typeof stepDefinition.payload.query === 'string' ?
    stepDefinition.payload.query : findPreviousOutputByKey(context, "query");
    if (!query || typeof query !== 'string' || query.trim() == '') {
      throw new Error('search_web step requires payload.query');
    }
    let max_result_count = stepDefinition.payload && typeof stepDefinition.payload.max_result_count === 'string' ?
    stepDefinition.payload.max_result_count : findPreviousOutputByKey(context, "max_result_count");
    const isInteger = (str) => {
      const num = Number(str);
      return Number.isInteger(num) && String(num) === str.trim();
    };
    if (!max_result_count || max_result_count.trim() == '' || !isInteger(max_result_count) || max_result_count < 0) {
      max_result_count = DEFAULT_SEARCH_RESUT_COUNT; //Default search result
    } else if (max_result_count > MAX_SEARCH_RESUT_COUNT) {
      max_result_count = MAX_SEARCH_RESUT_COUNT; //Max search result is 20
    }

    if (!config.search_web || !config.search_web.api_key) {
      throw new Error('Missing web search API key');
    }
    const client = tavily({
      apiKey: config.search_web.api_key
    });
    const response = await client.search(query, {
      searchDepth: 'basic',
      maxResults: max_result_count

    });
    const markdown = tavilyResultToMarkdown(response);
    return {
      text: markdown
    };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
      errors.push('Search result must be an object.');
    }
    if (!result.text || typeof result.text !== 'string') {
      errors.push('Search result must be in string type.');
    }
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }
};

function tavilyResultToMarkdown(searchResult) {
    if (!searchResult || typeof searchResult !== 'object') {
        return '# Search Result\n\nInvalid result.';
    }
    var lines = [];
    lines.push('# Search Result');
    lines.push('');
    if (searchResult.query) {
        lines.push('Query: ' + searchResult.query);
        lines.push('');
    }
    if (!Array.isArray(searchResult.results) || searchResult.results.length === 0) {
        lines.push('No results found.');
        return lines.join('\n');
    }
    searchResult.results.forEach(function (item, index) {
        lines.push('## Result ' + (index + 1));
        lines.push('');
        lines.push('**Title:** ' + (item.title || 'Untitled'));
        lines.push('');
        lines.push('**URL:** ' + (item.url || ''));
        lines.push('');
        lines.push('**Score:** ' + (typeof item.score === 'number' ? item.score : 'N/A'));
        lines.push('');
        lines.push('**Content:**');
        lines.push(item.content || '');
        lines.push('');
    });
    return lines.join('\n');
}