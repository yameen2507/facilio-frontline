CRM Deal / Sales Lifecycle 

Purpose: Define the Deal/Sales lifecycle after a Lead is qualified and assigned to Sales. 

Deal Lifecycle 

Assigned to Sales → Discovery → Survey Required → Survey Completed → Estimation / Commercial → Proposal Submitted → Negotiation → Decision Pending → Won / Lost 

1. Assigned to Sales 

The qualified Lead is converted/assigned to Sales. 

Objective: Sales takes ownership of the opportunity. 

Capture / track: 

Account, Contact, Deal, Lead information, AI Lead Intelligence, services requested, location, RFP/RFQ information, documents, communication history. 

2. Discovery 

Sales communicates with the customer and understands the requirement in more detail. 

Objective: Determine exactly what needs to be priced/surveyed. 

Capture / track: 

Customer requirements 

services 

facility type 

number of sites 

location 

approximate area 

frequency 

start date 

contract duration 

existing provider 

expectations 

special requirements 

RFP/tender requirements 

decision makers 

procurement process 

budget if available. 

3. Survey Required 

If a physical survey is required, Sales creates a survey requirement. 

Objective: Get the physical site information required for estimation. 

Capture / track: 

Site 

building 

location 

survey scope 

preferred survey date/time 

customer contact 

surveyor requirement. 

4. Survey Completed 

The Surveyor completes the site survey. 

Objective: Have a complete and usable site scope. 

Capture / track: 

Site 

building 

floors 

spaces 

area/measurements 

surface types 

cleaning services 

frequency 

condition where relevant 

manpower 

photos 

special requirements 

survey notes. 

5. Estimation / Commercial 

Estimator/Commercial uses Survey + Services + Rate Card + Commercial Rules. 

Objective: Produce the commercial offer. 

Capture / track: 

Manpower 

service quantities 

frequencies 

cost 

selling price 

minimum price 

margin 

contract value 

commercial assumptions. 

6. Proposal Submitted 

Sales/Commercial sends the proposal or quotation to the customer. 

Objective: Customer has received the formal commercial offer. 

Capture / track: 

Proposal version 

date submitted 

amount 

currency 

validity 

scope 

documents 

email/conversation 

customer response 

submission deadline if applicable. 

7. Negotiation 

Customer is actively discussing the proposal. 

Objective: Reach final commercial agreement. 

Capture / track: 

Price negotiations 

scope changes 

service changes 

manpower changes 

contract changes 

commercial changes 

objections 

competitor information 

revised proposals. 

8. Decision Pending 

Proposal is with the customer and Sales is waiting for the final decision. 

Objective: Await customer decision. 

Capture / track: 

Expected decision date 

decision maker 

current status 

outstanding questions 

follow-up activity 

customer feedback. 

9A. Won 

Customer accepts the proposal. 

Objective: Trigger Operations Handover for operational onboarding. 

Capture / track: 

Final agreed value 

final scope 

contract start date 

duration 

services 

final commercial terms 

signed contract/document 

customer contacts 

site information. 

9B. Lost 

Customer does not proceed. The Deal should retain why it was lost. 

Objective: Capture learning for analytics and future AI. 

Capture / track: 

Lost reason 

competitor if known 

customer feedback 

lost date 

lost amount 

reason details. 

 

Field 

Type 

Example 

Lost Reason 

Dropdown 

Price / Competitor / Scope / Budget / Timing / Customer Cancelled / Existing Provider / Service Capability / Region / Tender Cancelled / No Response / Other 

Lost Reason Detail 

Long Text 

Customer said our price was 18% higher than the selected vendor 

Competitor 

Lookup / Text 

ABC Facilities 

Competitor Price 

Currency 

$125,000 

Our Final Price 

Currency 

$148,000 

Price Difference 

Percentage 

18.4% 

Customer Budget 

Currency 

$130,000 

Customer Selected Vendor 

Text 

ABC Facilities 

Winning Vendor 

Lookup / Text 

ABC Facilities 

Customer Feedback 

Long Text 

Customer liked our technical proposal but selected another vendor due to price 

Customer Objections 

Long Text 

Price, manpower model 

Scope Difference 

Long Text 

Competitor excluded consumables 

Service Difference 

Long Text 

Competitor offered reduced cleaning frequency 

Commercial Terms Difference 

Long Text 

Competitor offered 60-day payment terms 

Decision Maker 

Contact 

Procurement Director 

Decision Influencers 

Long Text 

FM Manager recommended us; Procurement preferred lower price 

Incumbent Provider 

Text 

XYZ FM 

Why Customer Chose Competitor 

Long Text 

Lower price and longer payment terms 

Why Customer Did Not Choose Us 

Long Text 

Pricing perceived as high 

Customer Sentiment 

Dropdown 

Positive / Neutral / Negative 

Future Opportunity 

Dropdown 

High / Medium / Low / None 

Re-engagement Date 

Date 

01-Jan-2027 

Customer May Reconsider 

Yes/No 

Yes 

Lessons Learned 

Long Text 

Need more competitive pricing for similar retail contracts 

What Would Have Made Us Win? 

Long Text 

Lower price, better payment terms, faster mobilisation, better technical solution 

Lost By 

User 

Sales Executive 

Lost Date 

Date 

Auto 

Lost Stage 

Auto 

Negotiation 

Proposal Version 

Lookup 

Proposal V3 

 

Lifecycle Flexibility 

The Deal lifecycle should be controlled but flexible. Deals may skip stages when they are not applicable. 

Small existing-client requirement: Assigned to Sales → Discovery → Estimation → Proposal → Won 

Large facility contract: Assigned to Sales → Discovery → Survey Required → Survey Completed → Estimation → Proposal → Negotiation → Decision Pending → Won 

Customer immediately rejects proposal: Proposal Submitted → Lost 

Existing customer already has a complete survey: Discovery → Estimation → Proposal 

Recommended Deal Status List 

# 

Deal Stage 

Purpose 

1 

Oppurtunity 

Sales has received ownership 

2 

Discovery 

Sales understands requirements 

3 

Survey Required 

Physical/site survey is required 

4 

Survey Completed 

Survey information is complete 

5 

Estimation / Commercial 

Costing and pricing are being prepared 

6 

Proposal Submitted 

Proposal/quotation sent to customer 

7 

Negotiation 

Customer is negotiating scope/commercials 

8 

Decision Pending 

Waiting for customer decision 

9 

Won 

Customer accepted 

10 

Lost 

Opportunity did not proceed 

Important Development Rules 

Survey Required and Survey Completed must be skippable when a survey is not required. 

Won and Lost are terminal stages unless an authorized user reopens the Deal. 

Proposal versions should be retained; a revised proposal should not overwrite the previous version. 

Lost Deals should retain the Lost Reason and related feedback for future analytics and AI analysis. 

The Deal lifecycle is separate from the Lead lifecycle. 

A Won Deal moves to Operations Handover / Operational Onboarding. 

Overall CRM Flow 

Lead: New → AI Review → Action Required → Contacted → Follow-Up → Qualified → Assigned to Sales 

Deal: Assigned to Sales → Discovery → Survey Required → Survey Completed → Estimation / Commercial → Proposal Submitted → Negotiation → Decision Pending → Won / Lost 

Won Deal: Operations Handover → Operational Onboarding 