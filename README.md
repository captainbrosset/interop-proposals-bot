Interop focus are proposal helper bot

- Runs on new focus area proposal issue
  - Test is older issues from https://github.com/web-platform-tests/interop/issues?q=is%3Aissue%20label%3Afocus-area-proposal
- Gets useful info from the issue: spec URL, name of feature
  - It seems like proposers mostly use the template, which makes things simpler
  - Look for "Specification", followed by 1 or more spec URLs.
  - Title of issue is usually the feature name too. But that could be different from the feature name in web-features.
- Identifies the corresponding web-features ID, if any
- Using the web-features ID, find other useful data:
  - Spec
  - WPT tests
  - Use counters
  - Standards position
  - State of surveys
  - ...