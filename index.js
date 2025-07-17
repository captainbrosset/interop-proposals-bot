import "dotenv/config";
import { Octokit, App } from "octokit";
import { features } from "web-features";
import yargs from "yargs";

// This is used as a hidden HTML comment when posting comments to GitHub issues.
// This way, we can retrieve the comment later, and update it if needed.
const HIDDEN_COMMENT_IN_ISSUE = "<!-- interop-proposals-bot web-features update -->";
const GITHUB_API_VERSION = "2022-11-28";

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

// Extract URLs from the issue body that are likely to be specifications.
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

// Given a list of URLs, identify which web-features they match.
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

// Given a GitHub issue, find the web-features that are referenced in the issue body.
// For now, we only look for URLs that match the web-features specifications.
// TODO: find web-features IDs, but also try to match on other URLs too (WPT labels, MDN URLs, vendor positions, etc.)
function findFeaturesInIssue(issue) {
  const urlsInBodyOfIssue = extractSpecUrlsFromBody(issue.body);
  console.log(`Found ${urlsInBodyOfIssue.length} URL(s) in issue body, which may be specification(s):`);
  console.log(urlsInBodyOfIssue.map(s => `- ${s[0]}`).join("\n"));

  const features = identifyFeaturesFromSpecUrls(urlsInBodyOfIssue);
  return features;
}

// Given a feature id, retrieve the feature's data.
// We use the web-features-explorer's JSON files to get the full data, which includes both
// the data that comes from the web-features project and the additional data that the explorer augments it with.
async function getFeatureAugmentedData(feature) {
  console.log(`Getting data for feature ${feature.id}`);

  try {
    const response = await fetch(`https://web-platform-dx.github.io/web-features-explorer/features/${feature.id}.json`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching the feature data for ${feature.id}:`, error);
    return null;
  }
}

function printBaselineStatus(feature) {
  if (feature.status && feature.status.baseline === "high") {
    return "Widely Available";
  } else if (feature.status && feature.status.baseline === "low") {
    return "Newly Available";
  }
  return "Limited Availability";
}

function printDocs(feature) {
  if (!feature.mdnUrls.length) {
    return "";
  }

  const docs = feature.mdnUrls.map(url => `[${url.title}](${url.url})`).join(", ");
  return `* **Docs:** ${docs}\n`;
}

function printStandardPositions(feature) {
  if (!feature.standardPositions.mozilla.url && !feature.standardPositions.webkit.url) {
    return "";
  }

  let pos = "* **Standard positions:** ";

  if (feature.standardPositions.mozilla.url) {
    pos += `[Mozilla](${feature.standardPositions.mozilla.url})`;
  }
  if (feature.standardPositions.webkit.url) {
    pos += (pos ? ", " : "") + `[WebKit](${feature.standardPositions.webkit.url})`;
  }

  return pos + "\n";
}

function printUseCounter(feature) {
  if (!feature.useCounters.chromeStatusUrl) {
    return "";
  }
  return `* **Chrome use counter:** [chromestatus.com](${feature.useCounters.chromeStatusUrl})\n`;
}

function printSurveys(feature) {
  if (!feature.stateOfSurveys || !feature.stateOfSurveys.length) {
    return "";
  }

  const surveys = feature.stateOfSurveys.map(survey => {
    return `[${survey.name} (${survey.question} question)](${survey.link})`;
  }).join(", ");

  return `* **State of CSS/JS/HTML surveys:** ${surveys}\n`;
}

function printPreviousInterops(feature) {
  if (!feature.interop.length) {
    return "";
  }

  const interops = feature.interop.map(i => {
    return `[${i.year}](https://wpt.fyi/interop-2024?feature=${i.label})`;
  }).join(", ");

  return `* **Included in previous Interop iterations:** ${interops}\n`
}

function printWPTLink(feature) {
  if (!feature.wptLink) {
    return "";
  }
  return `* **WPT tests:** [wpt.fyi](https://wpt.fyi/results/?q=feature:${feature.id})\n`;
}

// Generate the markdown content for the given feature.
function prepareComment(feature) {
  let str = `The feature [${feature.name}](https://web-platform-dx.github.io/web-features-explorer/features/${feature.id}/) (from the [web-features project](https://github.com/web-platform-dx/web-features/)) was identified from the specification URLs you provided in the first comment.\n\n`;
  str += `Below is more information about the feature, which might help motivate your focus area proposal.\n\n`;

  str += `* **ID:** ${feature.id}\n`;
  str += `* **Name:** ${feature.name}\n`;
  str += `* **Description:** ${feature.description_html}\n`;
  str += `* **Baseline status:** ${printBaselineStatus(feature)}\n`;
  str += printDocs(feature);
  str += printStandardPositions(feature);
  str += printUseCounter(feature);
  str += printSurveys(feature);
  str += printPreviousInterops(feature);
  str += printWPTLink(feature);
  str += `\nFor more information, see the [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/${feature.id}/).`;

  // Add the hidden comment to find this comment again later.
  str += `\n${HIDDEN_COMMENT_IN_ISSUE}`;

  return str;
}

// Post a new comment with the given markdown content or update an existing comment if it already exists.
async function postOrUpdateComment(issueNumber, markdown) {
  // Retrieve existing comments to check if we already posted a comment.
  const commentsResponse = await octokit.request(`GET /repos/${argv.repo}/issues/${issueNumber}/comments`, {
    headers: {
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    }
  });
  const existingComment = commentsResponse.data.find(comment => comment.body.includes(HIDDEN_COMMENT_IN_ISSUE));

  if (existingComment) {
    // The bot already posted a comment. Update it.
    console.log(`Updating existing comment #${existingComment.id}...`);
    await octokit.request(`PATCH /repos/${argv.repo}/issues/comments/${existingComment.id}`, {
      body: markdown,
      headers: {
        "X-GitHub-Api-Version": GITHUB_API_VERSION
      }
    });
  } else {
    // Post a new comment.
    console.log(`Posting a new comment...`);
    await octokit.request(`POST /repos/${argv.repo}/issues/${issueNumber}/comments`, {
      body: markdown,
      headers: {
        "X-GitHub-Api-Version": GITHUB_API_VERSION
      }
    });
  }
}

// The main entry point to the script.
async function main() {
  const issue = await getReferencedIssue();

  console.log(`Processing issue #${issue.number}: "${issue.title}"`);
  const features = findFeaturesInIssue(issue);

  if (features.length === 0) {
    console.log("Could not find any matching features the issue body.");
    return;
  }

  console.log(`Found ${features.length} matching feature(s) based on specification URLs:`);
  console.log(features.map(f => `- ${f.id}`).join("\n"));

  // It's unlikely that multiple features would be found. Default to the first one if so.
  if (features.length > 1) {
    console.log("Multiple features found. Only the first one will be processed.");
  }

  const feature = features[0];

  const featureData = await getFeatureAugmentedData(feature);
  const markdown = prepareComment(featureData);

  await postOrUpdateComment(issue.number, markdown);
}

main();
