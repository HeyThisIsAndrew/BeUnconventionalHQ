#!/bin/bash
echo "Fetching repository info..."
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

echo "Creating Milestone..."
# Check if milestone exists
MILESTONE_ID=$(gh api repos/$REPO/milestones --jq '.[] | select(.title=="v2.0: Living Media Kit SaaS") | .number')

if [ -z "$MILESTONE_ID" ]; then
  echo "Milestone not found. Creating it now..."
  gh api -X POST repos/$REPO/milestones -f title="v2.0: Living Media Kit SaaS" -f description="Transition existing media kit infrastructure from single-tenant Astro build scripts into a multi-tenant micro-SaaS application." > /dev/null
  MILESTONE_ID=$(gh api repos/$REPO/milestones --jq '.[] | select(.title=="v2.0: Living Media Kit SaaS") | .number')
fi

echo "Milestone ID is $MILESTONE_ID"

echo "Assigning issues 159 through 168 to the milestone..."
for i in {159..168}; do
  gh issue edit $i --milestone "$MILESTONE_ID"
done

echo "Milestone assignment complete!"
