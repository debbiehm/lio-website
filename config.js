// Website settings. Fill in after creating the Supabase project (see SETUP.md).
// The anon key is meant to be public: the database rules (supabase/schema.sql) decide what each person can see.
window.LIO_CONFIG = {
  SUPABASE_URL: "",          // e.g. "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "",     // Project Settings → API → anon public key
  DEMO: false,               // true = no server: accounts and uploads are kept only in this browser (for trying the site)
  AGENT: {
    name: "CHENG HSZE MIN",
    iac: "6950741",
    whatsapp: "",            // e.g. "60123456789" (country code, no + or spaces). Empty = no WhatsApp button
  },
  // 「关注狮爷」buttons: fill what you have, leave the rest empty (an empty one is simply not shown)
  SOCIAL: {
    facebook: "",            // Facebook page address, e.g. "https://www.facebook.com/datoliotalk"
    messenger: "",           // the page's username for Messenger, e.g. "datoliotalk"  -> m.me/datoliotalk
    instagram: "",           // Instagram username without @, e.g. "datoliotalk"
  },
  // Meta (Facebook / Instagram) Pixel: shows your ads to people who visited the site. Empty = off.
  // Only loads after the visitor accepts cookies.
  META_PIXEL_ID: "",         // Events Manager → Data sources → your Pixel → the long number
};
