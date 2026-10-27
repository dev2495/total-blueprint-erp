# Profile

## Overview (English)
# My Profile

Every signed-in person has a **My Profile** page (/profile). It is opened from the user menu at the top right: "My Profile" opens the Profile tab, "Change Password" opens /profile?tab=security. Machine operators can open it too, even though their screens are otherwise limited to the machine terminal and maintenance.

## The three tabs
1. **Profile** – shows how many required fields are complete ("<done>/<total> required fields complete"). The card "Profile Update Request" lets you change First name, Last name, Email, Phone and Avatar URL. Changes do not apply at once: "Changes to profile fields go through admin approval before they become active." Press "Submit For Approval".
2. **Requests** – "My Change Requests" lists each request with Submitted, Requested changes, Status and Reviewed. A pending request can be cancelled with "Cancel".
3. **Security** – "Change Password": Current password, New password, Confirm new password, then "Update Password". The change is immediate; all your other sessions are signed out and you must sign in again.

## How a change is approved
1. You submit the request on the Profile tab.
2. An Owner or Admin opens Governance → Profile Approvals, reads Requested changes, adds an optional review note and presses Approve or Reject.
3. You see the result on the Requests tab; approved values now show everywhere.

## Rules
- Email is mandatory for every user and cannot be emptied.
- You must change at least one field before submitting.
- Only pending requests can be cancelled or reviewed.
- Your own email can only change through this approval, not by editing your account directly.
- A new password must pass the password rules (length, not too common, not only numbers) and must match the confirmation.
- Roles, permissions, machines and work centres are not on this page; only an admin changes them in User Management.

## Who uses it
All roles: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER. A typical use: a new operator gets an initial password from the admin, signs in, and changes it on the Security tab the same day.

## What the admin sees
The request lands in Governance → Profile Approvals with your name as Requestor, the old and new values under Requested changes and the time Submitted. The admin can write a review note that you see on the Requests tab. Every approval, rejection and password change is written to the audit ledger (Permissions and Session & Login streams), so changes to your account can always be traced.

## Tips for floor and office staff
- Keep your phone number current: supervisors and the admin use it when a job or a dispatch needs you.
- Use a password you can remember but others cannot guess; do not share it with the next shift. Each person should sign in with their own account so outputs and dispatches show the right name.
- On a shared factory computer, sign out from the user menu when you leave.
- If you change jobs (for example from operator to work-centre manager), your page list changes only after the admin changes your role; then sign out and in again.

## Problems and fixes
- *"No changes detected"*: you pressed submit without changing anything.
- *"Email required"*: put your email back.
- *"Password mismatch"*: the new password and the confirmation differ.
- *"Current password is incorrect"*: type your present password; if you forgot it, ask an admin to reset it in User Management.
- *Request stays pending for days*: remind an Owner/Admin to check Governance → Profile Approvals.
- *Locked after wrong passwords*: wait 15 minutes or ask an admin to reset the password.
- *You need another page or machine*: this page cannot do it; ask your admin.

## सारांश (हिंदी)
# My Profile (मेरी प्रोफ़ाइल)

हर login यूज़र का एक **My Profile** पेज (/profile) होता है। इसे ऊपर दाईं ओर user menu से खोलें: "My Profile" से Profile टैब, "Change Password" से /profile?tab=security खुलता है। Machine operator भी इसे खोल सकते हैं, जबकि उनकी बाकी स्क्रीन सिर्फ़ machine terminal और maintenance तक सीमित हैं।

## तीन टैब
1. **Profile** – दिखाता है कि कितने ज़रूरी field भरे हैं ("<done>/<total> required fields complete")। "Profile Update Request" card में First name, Last name, Email, Phone और Avatar URL बदल सकते हैं। बदलाव तुरंत लागू नहीं होते: पहले admin की मंज़ूरी लगती है। "Submit For Approval" दबाएँ।
2. **Requests** – "My Change Requests" में हर request के साथ Submitted, Requested changes, Status और Reviewed दिखते हैं। Pending request को "Cancel" से रद्द कर सकते हैं।
3. **Security** – "Change Password": Current password, New password, Confirm new password भरें, फिर "Update Password"। बदलाव तुरंत होता है; आपके बाकी सभी session बंद हो जाते हैं और फिर से login करना पड़ता है।

## बदलाव कैसे मंज़ूर होता है
1. आप Profile टैब पर request भेजते हैं।
2. Owner या Admin, Governance → Profile Approvals खोलकर Requested changes पढ़ता है, चाहे तो note लिखता है और Approve या Reject दबाता है।
3. नतीजा आपको Requests टैब पर दिखता है; मंज़ूर values हर जगह दिखने लगती हैं।

## नियम
- हर यूज़र के लिए Email ज़रूरी है, खाली नहीं किया जा सकता।
- भेजने से पहले कम से कम एक field बदलना ज़रूरी है।
- सिर्फ़ pending request ही रद्द या review हो सकती है।
- अपना email सिर्फ़ इसी मंज़ूरी से बदलता है, सीधे खाते में बदलकर नहीं।
- नया password नियम पूरे करे (लंबाई, बहुत आम नहीं, सिर्फ़ अंक नहीं) और पुष्टि से मेल खाए।
- रोल, permission, machine और work centre इस पेज पर नहीं हैं; इन्हें सिर्फ़ admin User Management में बदलता है।

## कौन इस्तेमाल करता है
सभी रोल: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER। आम उदाहरण: नए operator को admin से शुरुआती password मिलता है, वह login करता है और उसी दिन Security टैब पर उसे बदल देता है।

## Admin को क्या दिखता है
Request, Governance → Profile Approvals में पहुँचती है: Requestor में आपका नाम, Requested changes में पुरानी और नई values, और Submitted का समय। Admin एक review note लिख सकता है जो आपको Requests टैब पर दिखता है। हर मंज़ूरी, अस्वीकृति और password बदलाव audit रजिस्टर (Permissions और Session & Login stream) में दर्ज होता है, इसलिए आपके खाते का हर बदलाव बाद में देखा जा सकता है।

## Floor और office स्टाफ़ के लिए सुझाव
- अपना phone नंबर सही रखें: किसी job या dispatch में ज़रूरत पड़ने पर supervisor और admin इसी से संपर्क करते हैं।
- ऐसा password रखें जो आपको याद रहे पर दूसरे अंदाज़ा न लगा सकें; अगली shift वाले को न बताएँ। हर व्यक्ति अपने खाते से login करे ताकि output और dispatch पर सही नाम आए।
- साझा factory computer पर काम खत्म होने पर user menu से sign out करें।
- काम बदलने पर (जैसे operator से work-centre manager), आपके पेज तभी बदलते हैं जब admin आपका रोल बदले; फिर sign out करके दोबारा login करें।

## दिक्कतें और हल
- *"No changes detected"*: बिना कुछ बदले submit दबाया।
- *"Email required"*: अपना email वापस भरें।
- *"Password mismatch"*: नया password और पुष्टि अलग हैं।
- *"Current password is incorrect"*: मौजूदा password लिखें; भूल गए हों तो admin से User Management में reset करवाएँ।
- *Request कई दिन से pending*: Owner/Admin को Governance → Profile Approvals देखने को कहें।
- *गलत password से खाता बंद*: 15 मिनट रुकें या admin से password reset करवाएँ।
- *दूसरा पेज या machine चाहिए*: यह पेज ऐसा नहीं कर सकता; admin से कहें।

## Every screen (English)

### My Profile (/profile)
Screen address: /profile · Roles: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER · Share link: https://erp.totalpolyprint.com/guide?page=profile

Your own account: request changes to your details, track those requests, and change your password.

Open it from the user menu ("My Profile" or "Change Password"). Detail changes go to an admin for approval (Governance → Profile Approvals); password changes apply at once.

**Before you start**
- Any signed-in user. Machine operators can open it too.

**Step by step**
1. Tab "Profile": check the badge "<done>/<total> required fields complete".
2. Under "Profile Update Request" change First name, Last name, Email, Phone or Avatar URL.
3. Press "Submit For Approval". You see "Request submitted — pending admin approval".
4. Tab "Requests": "My Change Requests" shows Submitted, Requested changes, Status, Reviewed; "Cancel" a pending one.
5. Tab "Security" → "Change Password": fill "Current password", "New password", "Confirm new password", press "Update Password".
6. After "Password updated" sign in again with the new password.

**What is on the screen**
- **First name / Last name / Email / Phone / Avatar URL**: Requested values; they apply only after admin approval. Email is mandatory.
- **Status (requests)**: Pending, approved, rejected or cancelled.
- **Current / New / Confirm password**: Current must be right; new must pass the password rules; both new fields must match.

**Common problems and fixes**
- "No changes detected — Update at least one profile field before submitting." — Change a field first.
- "Email required — Email is mandatory for all users." — Do not leave Email blank.
- "Missing fields — Fill current, new, and confirm password." — Fill all three password boxes.
- "Password mismatch" — New password and confirmation differ. Type them again.
- "Current password is incorrect" — Type your present password; if forgotten, ask an admin to reset it in User Management.
- "Only pending requests can be cancelled" — The admin already reviewed it.

**If stuck**
1. If your request stays pending, tell an Owner/Admin to open Governance → Profile Approvals.
2. Too many wrong sign-ins lock the account for 15 minutes.

Related pages: /system/governance, /help

**Not done yet / watch out**
- Users cannot change their own role, machines or work centres here; only an admin can.

## हर स्क्रीन (हिंदी)

### My Profile (मेरी प्रोफ़ाइल) (/profile)
स्क्रीन का पता: /profile · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=profile&lang=hi

आपका अपना खाता: अपनी जानकारी बदलने की request भेजें, उन requests को देखें, और password बदलें।

User menu ("My Profile" या "Change Password") से खोलें। जानकारी के बदलाव admin के पास मंज़ूरी को जाते हैं (Governance → Profile Approvals); password तुरंत बदलता है।

**शुरू करने से पहले**
- कोई भी login यूज़र। Machine operator भी खोल सकते हैं।

**स्टेप बाय स्टेप**
1. टैब "Profile": badge "<done>/<total> required fields complete" देखें।
2. "Profile Update Request" में First name, Last name, Email, Phone या Avatar URL बदलें।
3. "Submit For Approval" दबाएँ। "Request submitted — pending admin approval" दिखेगा।
4. टैब "Requests": "My Change Requests" में Submitted, Requested changes, Status, Reviewed दिखते हैं; बाकी (pending) request को "Cancel" कर सकते हैं।
5. टैब "Security" → "Change Password": "Current password", "New password", "Confirm new password" भरें, "Update Password" दबाएँ।
6. "Password updated" के बाद नए password से फिर login करें।

**स्क्रीन पर क्या है**
- **"First name / Last name / Email / Phone / Avatar URL" वाला हिस्सा**: माँगी गई values; admin की मंज़ूरी के बाद ही लागू। Email ज़रूरी है।
- **"Status (requests)" वाला हिस्सा**: Pending, approved, rejected या cancelled।
- **"Current / New / Confirm password" वाला हिस्सा**: Current सही होना चाहिए; नया password नियम पूरे करे; दोनों नए field मेल खाएँ।

**आम दिक्कतें और हल**
- "स्क्रीन पर संदेश: "No changes detected — Update at least one profile field before submitting."" — पहले कोई field बदलें।
- "स्क्रीन पर संदेश: "Email required — Email is mandatory for all users."" — Email खाली न छोड़ें।
- "स्क्रीन पर संदेश: "Missing fields — Fill current, new, and confirm password."" — तीनों password बॉक्स भरें।
- "स्क्रीन पर संदेश: "Password mismatch"" — नया password और पुष्टि अलग हैं। फिर से लिखें।
- "स्क्रीन पर संदेश: "Current password is incorrect"" — अपना मौजूदा password लिखें; भूल गए हों तो admin से User Management में reset करवाएँ।
- "स्क्रीन पर संदेश: "Only pending requests can be cancelled"" — Admin ने पहले ही उसे देख लिया है।

**अटक गए तो**
1. Request pending ही रहे तो Owner/Admin को Governance → Profile Approvals खोलने को कहें।
2. बहुत बार गलत login से खाता 15 मिनट के लिए बंद होता है।

जुड़े पेज: /system/governance, /help

**अभी नहीं होता / ध्यान दें**
- यूज़र यहाँ अपना रोल, machine या work centre नहीं बदल सकते; सिर्फ़ admin बदल सकता है।
