import "dotenv/config";
import { Octokit, App } from "octokit";
import { features } from "web-features";
import yargs from "yargs";

const argv = yargs(process.argv)
  .option("number", {
    alias: "n",
    type: "number",
    default: false,
    describe: "The issue number to process",
  })
  .option("repo", {
    alias: "r",
    type: "string",
    describe: "The owner and repository name. For example: web-platform-tests/interop",
  }).argv;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function getReferencedIssue() {
  const response = await octokit.request(`GET /repos/${argv.repo}/issues/${argv.number}`,);
  return response.data;
}

function extractSpecUrlsFromBody(body) {
  const urls = body.match(/https?:\/\/[^)\s]+/g) || [];

  return urls
    .filter(url => {
      // Filter out known non-spec URLs.
      return !url.includes("bugzilla") &&
        !url.includes("github.com") &&
        !url.includes("webkit.org") &&
        !url.includes("developer.mozilla.org") &&
        !url.includes("developer.chrome.com") &&
        !url.includes("wpt.fyi") &&
        !url.includes("css-tricks") &&
        !url.includes("webstatus.dev") &&
        !url.includes("learn.microsoft.com") &&
        !url.includes("chromium.org");
    }).map(url => {
      // Separate the # from the URL if it exists.
      return [url, url.split("#")[0]];
    });
}

function identifyFeaturesFromSpecUrls(specUrlsInIssue) {
  const matchingFeatures = [];

  for (const [candidateUrl, candidateUrlNoAnchor] of specUrlsInIssue) {
    for (const id in features) {
      const feature = features[id];
      feature.id = id;
      const featureSpecs = Array.isArray(feature.spec) ? feature.spec : [feature.spec];

      if (featureSpecs.some(spec => spec === candidateUrl || spec === candidateUrlNoAnchor)) {
        matchingFeatures.push(feature);
      }
    }
  }

  return matchingFeatures;
}

function findFeaturesInIssue(issue) {
  const urlsInBodyOfIssue = extractSpecUrlsFromBody(issue.body);
  const features = identifyFeaturesFromSpecUrls(urlsInBodyOfIssue);
  return features;
}

async function getFeatureAugmentedData(feature) {
  const response = await fetch(`https://web-platform-dx.github.io/web-features-explorer/features/${feature.id}.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch feature data for ${feature.id}: ${response.statusText}`);
  }
  const data = await response.json();
  return data;
}

async function main() {
  const issue = await getReferencedIssue();

  console.log(`Process issue #${issue.number}: ${issue.title}`);
  const features = findFeaturesInIssue(issue);

  if (features.length !== 0) {
    console.log(`  - Found ${features.length} matching feature(s): ${features.map(f => f.id).join(", ")}`);
    for (const feature of features) {
      try {
        const featureData = await getFeatureAugmentedData(feature);
        console.log(featureData);
      } catch (error) {
        console.error(`    - Error fetching data for feature ${feature.id}:`, error);
      }
    }
  }
}

main();
