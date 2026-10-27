# Signing in

## Overview (English)
# Access: signing in

Access covers how people get into the ERP: the normal sign-in page, the admin console sign-in and the root address that sends each person to their own home page.

## Screens

- **Sign in** (`/login`): *Work email or username*, *Password* (eye button to show), *Sign in*. Wait for *Client ready* before signing in.
- **System Admin Console** (`/admin-login`): *Admin email*, *Password*, *TOTP* (6 digits), *Enter admin console*.
- **Root** (`/`): shows *Redirecting to your dashboard...* and sends you on.

## Where each role lands

| Role | Home |
|---|---|
| Admin, Super Admin | /dashboard/admin |
| Owner | /dashboard/owner |
| Sales | /dashboard/sales |
| Planner | /dashboard/planner |
| Work center manager | /production/work-center |
| Operator | /production/machine-selector |
| Store | /inventory/rolls |
| Dispatch | /dashboard/logistics |
| Plant manager | /analytics/kpis |
| Watchman | /gate |

An unknown role lands on the admin dashboard. Pages show only what a role may use; an operator stays on machine screens, maintenance, profile and help.

## Rules

- Accounts are created by the administrator. There is no self-service password reset (*Forgot? Ask your administrator*).
- 10 wrong passwords in 15 minutes lock the account for 15 minutes.
- Username or email both work.
- Visitors never sign in; they use the gate QR form.

## Signing in step by step

1. Open the ERP address. If you are not signed in, the root page sends you to `/login`.
2. Wait until the badge under *Welcome back* says *Client ready* (it says *Preparing session* while the page gets ready).
3. Type your work email or your username, for example `ravi` or `ravi@company.com`.
4. Type the password. The eye button shows or hides it so you can check for typing mistakes.
5. Press *Sign in* (it shows *Signing in...* while it works). On success you land on your role's home page.
6. Administrators who use the console open `/admin-login`, type admin email, password and the 6-digit code, and press *Enter admin console*.

## What the sign-in page tells you

The left panel explains three things: *Your workspace* is role aware (your account opens its assigned tools), *Access* is policy controlled (permissions apply across ERP modules), and *Workflows* are connected records. The small notes under the form say: use your work credentials, your workspace is set by your assigned role, and contact your ERP administrator if you need access.

## How access works after sign-in

- Each page shows only the menus and buttons your role may use. If you type the address of a page meant for another role, it may show *Not available* or redirect you.
- The server checks every action as well, so a hidden button cannot be forced.
- Master data, engineering, factory set-up and system pages open only for the roles listed on their sidebar entry.
- A watchman sees only the gate terminal. An operator sees only machine screens, maintenance, profile and help.
- Admins can preview another role; the preview changes menus, but gate master rights follow the real role.

## Who does what

- **Administrator**: creates users, sets roles and plant or gate assignments, resets passwords and unlocks accounts.
- **Every user**: keeps the password private and signs out on shared floor PCs.

## Problems and fixes

- *No active account found with the given credentials.* – wrong username/password or the account is inactive.
- *Too many failed sign-in attempts…* – wait 15 minutes or ask the admin to reset the password.
- *Server error (…)* – try again shortly; tell the admin if it repeats.
- *Login succeeded but the user session could not be hydrated.* – reload and sign in again.
- Stuck on *Redirecting…* – reload; sign in again.
- Wrong home page – the admin checks your role.

## सारांश (हिंदी)
# एक्सेस: लॉगिन

एक्सेस बताता है लोग ERP में कैसे आते हैं: आम लॉगिन पेज, एडमिन कंसोल लॉगिन, और मुख्य पता जो हर व्यक्ति को उसके अपने होम पेज पर भेजता है।

## स्क्रीन

- **Sign in** (`/login`): *Work email or username*, *Password* (आँख वाला बटन दिखाता है), *Sign in*। लॉगिन से पहले *Client ready* आने दें।
- **System Admin Console** (`/admin-login`): *Admin email*, *Password*, *TOTP* (6 अंक), *Enter admin console*।
- **Root** (`/`): *Redirecting to your dashboard...* दिखाकर आगे भेजता है।

## कौन सा रोल कहाँ पहुँचता है

| रोल | होम |
|---|---|
| Admin, Super Admin | /dashboard/admin |
| Owner | /dashboard/owner |
| Sales | /dashboard/sales |
| Planner | /dashboard/planner |
| Work center manager | /production/work-center |
| Operator | /production/machine-selector |
| Store | /inventory/rolls |
| Dispatch | /dashboard/logistics |
| Plant manager | /analytics/kpis |
| Watchman | /gate |

अनजान रोल एडमिन डैशबोर्ड पर जाता है। हर पेज सिर्फ़ वही दिखाता है जो रोल इस्तेमाल कर सकता है; ऑपरेटर सिर्फ़ मशीन स्क्रीन, मेंटेनेंस, प्रोफ़ाइल और हेल्प पर रहता है।

## नियम

- अकाउंट एडमिन बनाता है। खुद से पासवर्ड रीसेट नहीं होता (*Forgot? Ask your administrator*)।
- 15 मिनट में 10 गलत पासवर्ड पर अकाउंट 15 मिनट के लिए लॉक होता है।
- यूज़रनेम या ईमेल, दोनों चलते हैं।
- विज़िटर कभी लॉगिन नहीं करते; वो गेट QR फ़ॉर्म इस्तेमाल करते हैं।

## लॉगिन कदम-दर-कदम

1. ERP का पता खोलें। लॉगिन नहीं है तो मुख्य पेज आपको `/login` पर भेज देगा।
2. *Welcome back* के नीचे *Client ready* आने तक रुकें (पेज तैयार होते समय *Preparing session* दिखता है)।
3. अपना वर्क ईमेल या यूज़रनेम लिखें, जैसे `ravi` या `ravi@company.com`।
4. पासवर्ड लिखें। आँख वाला बटन पासवर्ड दिखाता/छुपाता है ताकि टाइपिंग की गलती देख सकें।
5. *Sign in* दबाएँ (काम होते समय *Signing in...* दिखता है)। सही होने पर अपने रोल के होम पेज पर पहुँचेंगे।
6. कंसोल इस्तेमाल करने वाले एडमिन `/admin-login` खोलें, एडमिन ईमेल, पासवर्ड और 6 अंकों का कोड लिखें, और *Enter admin console* दबाएँ।

## लॉगिन पेज क्या बताता है

बाईं तरफ़ तीन बातें लिखी हैं: *Your workspace* रोल के हिसाब से है (आपका अकाउंट अपने तय टूल खोलता है), *Access* नीति से नियंत्रित है (अनुमतियाँ सारे ERP मॉड्यूल पर लागू), और *Workflows* आपस में जुड़े रिकॉर्ड हैं। फ़ॉर्म के नीचे के छोटे नोट कहते हैं: अपने काम वाले लॉगिन इस्तेमाल करें, वर्कस्पेस आपके रोल से तय होता है, और एक्सेस चाहिए तो ERP एडमिन से संपर्क करें।

## लॉगिन के बाद एक्सेस कैसे चलता है

- हर पेज सिर्फ़ वही मेन्यू और बटन दिखाता है जो आपका रोल इस्तेमाल कर सकता है। किसी दूसरे रोल के पेज का पता खुद लिखेंगे तो *Not available* दिख सकता है या दूसरी जगह भेज दिया जाएगा।
- सर्वर भी हर काम जाँचता है, इसलिए छुपा बटन ज़बरदस्ती नहीं चलता।
- मास्टर डेटा, इंजीनियरिंग, फ़ैक्टरी सेटअप और सिस्टम पेज सिर्फ़ उन्हीं रोल के लिए खुलते हैं जो उनकी साइडबार एंट्री में लिखे हैं।
- वॉचमैन को सिर्फ़ गेट टर्मिनल दिखता है। ऑपरेटर को सिर्फ़ मशीन स्क्रीन, मेंटेनेंस, प्रोफ़ाइल और हेल्प।
- एडमिन किसी और रोल का प्रीव्यू देख सकता है; प्रीव्यू से मेन्यू बदलते हैं, पर गेट मास्टर के अधिकार असली रोल से चलते हैं।

## कौन क्या करता है

- **एडमिन**: यूज़र बनाता है, रोल और प्लांट/गेट असाइन करता है, पासवर्ड रीसेट करता है और लॉक खोलता है।
- **हर यूज़र**: पासवर्ड किसी को न बताए और फ़्लोर के साझा PC पर काम के बाद लॉग-आउट करे।

## समस्याएँ और हल

- *No active account found with the given credentials.* – यूज़रनेम/पासवर्ड गलत या अकाउंट बंद।
- *Too many failed sign-in attempts…* – 15 मिनट रुकें या एडमिन से पासवर्ड रीसेट करवाएँ।
- *Server error (…)* – थोड़ी देर बाद कोशिश करें; बार-बार हो तो एडमिन को बताएँ।
- *Login succeeded but the user session could not be hydrated.* – रीलोड करके फिर लॉगिन करें।
- *Redirecting…* पर अटका – रीलोड करें; फिर लॉगिन करें।
- गलत होम पेज – एडमिन आपका रोल जाँचे।

## Every screen (English)

### System Admin Console sign-in (/admin-login)
Screen address: /admin-login · Roles: ADMIN, SUPER_ADMIN, OWNER · Share link: https://erp.totalpolyprint.com/guide?page=admin-login

Separate sign-in screen for administrators: admin email, password and a 6-digit admin code (TOTP).

Used by system administrators to enter the admin console. Normal staff use /login.

**Before you start**
- An administrator account.

**Step by step**
1. Type "Admin email".
2. Type "Password".
3. Type the 6-digit code in "TOTP".
4. Press "Enter admin console".

**What is on the screen**
- **TOTP**: 6-digit admin code; the screen will not submit with fewer digits.

**Common problems and fixes**
- "Enter your 6 digit admin code." — The TOTP box has fewer than 6 digits.
- "Invalid admin credentials / No active account found with the given credentials." — Email or password is wrong, or the account is inactive.
- "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password." — The account is locked for 15 minutes after repeated wrong tries.

**If stuck**
1. If the console does not open, sign in on /login with the same account.

Related pages: /login, /dashboard/admin

**Not done yet / watch out**
- The admin sign-in asks for a 6-digit TOTP code but only the email and password are sent to the server; the code is not checked.

### Sign in (Welcome back) (/login)
Screen address: /login · Roles: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER, WATCHMAN · Share link: https://erp.totalpolyprint.com/guide?page=login

Sign in to Total Poly Print ERP with your work email or username and password. Your role decides which workspace opens.

Every user starts here. After sign-in you land on your role's home: e.g. Dispatch → logistics dashboard, Watchman → /gate, Operator → machine selector, Store → rolls.

**Before you start**
- An active user account created by the administrator.

**Step by step**
1. Wait for "Client ready" under the title.
2. Type "Work email or username".
3. Type "Password" (the eye button shows or hides it).
4. Press "Sign in".

**What is on the screen**
- **Work email or username**: Either works, e.g. ravi or ravi@company.com.
- **Forgot? Ask your administrator**: There is no self-service reset; the administrator resets the password.

**Common problems and fixes**
- "No active account found with the given credentials." — Wrong username or password, or the account is inactive. Check Caps Lock and spelling; ask the admin if it persists.
- "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password." — 10 wrong tries in 15 minutes lock the account for 15 minutes.
- "Server error (500) …" — The server had a problem. Try again in a minute; tell the admin if it repeats.
- "Login succeeded but the user session could not be hydrated." — Sign-in worked but the session did not load. Reload the page and sign in again.

**If stuck**
1. Reload the page if "Preparing session" stays for long.
2. If you land on a page you cannot use, ask the admin to check your role.

Related pages: /, /admin-login, /gate

**Not done yet / watch out**
- There is no self-service password reset; users must ask an administrator.

## हर स्क्रीन (हिंदी)

### System Admin Console लॉगिन (/admin-login)
स्क्रीन का पता: /admin-login · भूमिकाएँ: ADMIN, SUPER_ADMIN, OWNER · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=admin-login&lang=hi

एडमिन के लिए अलग लॉगिन स्क्रीन: एडमिन ईमेल, पासवर्ड और 6 अंकों का एडमिन कोड (TOTP)।

सिस्टम एडमिन कंसोल में जाने के लिए। आम स्टाफ़ /login इस्तेमाल करता है।

**शुरू करने से पहले**
- एक एडमिन अकाउंट।

**स्टेप बाय स्टेप**
1. "Admin email" लिखें।
2. "Password" लिखें।
3. "TOTP" में 6 अंकों का कोड लिखें।
4. "Enter admin console" दबाएँ।

**स्क्रीन पर क्या है**
- **TOTP**: 6 अंकों का एडमिन कोड; कम अंक होने पर स्क्रीन आगे नहीं बढ़ती।

**आम दिक्कतें और हल**
- "Enter your 6 digit admin code." — TOTP में 6 से कम अंक हैं।
- "Invalid admin credentials / No active account found with the given credentials." — ईमेल या पासवर्ड गलत है, या अकाउंट बंद है।
- "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password." — बार-बार गलत कोशिश के बाद अकाउंट 15 मिनट के लिए लॉक है।

**अटक गए तो**
1. कंसोल न खुले तो उसी अकाउंट से /login पर लॉगिन करें।

जुड़े पेज: /login, /dashboard/admin

**अभी नहीं होता / ध्यान दें**
- एडमिन लॉगिन 6 अंकों का TOTP माँगता है पर सर्वर को सिर्फ़ ईमेल और पासवर्ड जाता है; कोड जाँचा नहीं जाता।

### Sign in (लॉगिन) (/login)
स्क्रीन का पता: /login · भूमिकाएँ: ADMIN, OWNER, SUPER_ADMIN, SALES, PLANNER, WORK_CENTER_MANAGER, OPERATOR, STORE, DISPATCH, PLANT_MANAGER, WATCHMAN · शेयर लिंक: https://erp.totalpolyprint.com/guide?page=login&lang=hi

Total Poly Print ERP में अपने वर्क ईमेल या यूज़रनेम और पासवर्ड से लॉगिन करें। आपका रोल तय करता है कौन सा वर्कस्पेस खुलेगा।

हर यूज़र यहीं से शुरू करता है। लॉगिन के बाद अपने रोल के होम पर पहुँचते हैं: जैसे Dispatch → logistics dashboard, Watchman → /gate, Operator → machine selector, Store → rolls।

**शुरू करने से पहले**
- एडमिन का बनाया हुआ active यूज़र अकाउंट।

**स्टेप बाय स्टेप**
1. टाइटल के नीचे "Client ready" आने दें।
2. "Work email or username" लिखें।
3. "Password" लिखें (आँख वाला बटन दिखाता/छुपाता है)।
4. "Sign in" दबाएँ।

**स्क्रीन पर क्या है**
- **Work email or username**: दोनों चलते हैं, जैसे ravi या ravi@company.com।
- **Forgot? Ask your administrator**: खुद से रीसेट नहीं होता; एडमिन पासवर्ड रीसेट करता है।

**आम दिक्कतें और हल**
- "No active account found with the given credentials." — यूज़रनेम या पासवर्ड गलत है, या अकाउंट बंद है। Caps Lock और स्पेलिंग देखें; बार-बार हो तो एडमिन से पूछें।
- "Too many failed sign-in attempts for this account. Wait 15 minutes or ask an administrator to reset the password." — 15 मिनट में 10 गलत कोशिश पर अकाउंट 15 मिनट के लिए लॉक होता है।
- "Server error (500) …" — सर्वर में दिक्कत है। एक मिनट बाद फिर कोशिश करें; बार-बार हो तो एडमिन को बताएँ।
- "Login succeeded but the user session could not be hydrated." — लॉगिन हुआ पर सेशन लोड नहीं हुआ। पेज रीलोड करके फिर लॉगिन करें।

**अटक गए तो**
1. "Preparing session" देर तक रहे तो पेज रीलोड करें।
2. ऐसे पेज पर पहुँचें जो आपके काम का नहीं तो एडमिन से अपना रोल जँचवाएँ।

जुड़े पेज: /, /admin-login, /gate

**अभी नहीं होता / ध्यान दें**
- खुद से पासवर्ड रीसेट नहीं होता; यूज़र को एडमिन से कहना पड़ता है।
