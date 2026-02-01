-- Create votes table for questions and answers (Safe version - doesn't drop existing table)
-- This table stores upvotes and downvotes from users
-- Run this in your Supabase SQL Editor

-- Only create if it doesn't exist
CREATE TABLE IF NOT EXISTS public.votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    answer_id UUID REFERENCES answers(id) ON DELETE CASCADE,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('upvote', 'downvote')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure either question_id or answer_id is set, but not both
    CONSTRAINT votes_item_check CHECK (
        (question_id IS NOT NULL AND answer_id IS NULL) OR
        (question_id IS NULL AND answer_id IS NOT NULL)
    )
);

-- Create indexes for better query performance (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON public.votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_question_id ON public.votes(question_id);
CREATE INDEX IF NOT EXISTS idx_votes_answer_id ON public.votes(answer_id);

-- Unique partial indexes to ensure one vote per user per question/answer
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_user_question_unique 
    ON public.votes(user_id, question_id) 
    WHERE question_id IS NOT NULL;
    
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_user_answer_unique 
    ON public.votes(user_id, answer_id) 
    WHERE answer_id IS NOT NULL;

-- Enable Row Level Security (RLS) - only if not already enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'votes' 
        AND rowsecurity = true
    ) THEN
        ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Drop existing policies if they exist, then create new ones
DROP POLICY IF EXISTS "Anyone can view votes" ON public.votes;
CREATE POLICY "Anyone can view votes" ON public.votes
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can create their own votes" ON public.votes;
CREATE POLICY "Users can create their own votes" ON public.votes
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own votes" ON public.votes;
CREATE POLICY "Users can update their own votes" ON public.votes
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own votes" ON public.votes;
CREATE POLICY "Users can delete their own votes" ON public.votes
    FOR DELETE
    USING (auth.uid() = user_id);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.votes TO authenticated;
GRANT SELECT ON public.votes TO anon;

