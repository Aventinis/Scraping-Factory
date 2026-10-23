// Issue #388: the advisory robots.txt check (evaluateRobotsTxt) and the
// generated scripts' run-time check must agree on RFC 9309 matching. Both run
// test-vectors/robots.json; the script half is
// companion/ScrapingFactory.Tests/RobotsVectorTests.cs.
const { loadVectors } = require('../../test-vectors/load');
const { evaluateRobotsTxt } = require('./content-script');

const { cases } = loadVectors('robots.json');

describe('evaluateRobotsTxt (shared vectors)', () => {
  test.each(cases.filter((c) => !c.appliesTo || c.appliesTo.includes('js')).map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(evaluateRobotsTxt(c.robots, c.path).allowed).toBe(c.allowed);
  });
});
