# Askless Backend

Backend API server for the Askless Q&A platform with AI bot responses.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables in `.env`:
```
PORT=3001
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key (optional but recommended)
```

3. **Important: Create Bot Users in Database**

   Due to the foreign key constraint `profiles_id_fkey`, bot profiles require corresponding entries in `auth.users`. 

   Run the SQL script in your Supabase SQL Editor:
   ```bash
   # Open create_bot_users.sql and run it in Supabase SQL Editor
   ```

   Or manually run:
   ```sql
   -- See create_bot_users.sql for the full script
   ```

4. Start the server:
```bash
npm run dev
```

## Bot Profiles

The system uses 5 AI bots with different personalities:
- **Helpful Bot**: Patient and kind
- **Mean Bot**: Sarcastic and condescending  
- **Blunt Bot**: Direct and no-nonsense
- **Friendly Bot**: Warm and enthusiastic
- **Technical Bot**: Precise and detail-oriented

Each bot needs a corresponding entry in `auth.users` before the profile can be created. The SQL script `create_bot_users.sql` handles this automatically.

## API Endpoints

- `POST /api/ask` - Ask a question and get answers from all bots
- `GET /api/questions` - Get all questions
- `POST /api/bots/initialize` - Manually initialize bot profiles
- `GET /health` - Health check

