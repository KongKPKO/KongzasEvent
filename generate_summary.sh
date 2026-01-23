#!/bin/bash

OUTPUT_FILE="/Users/Kongphop-Doppio/.gemini/antigravity/brain/176862f3-9fc5-47e9-b332-f54fb50d0f5c/Codebase_Summary.md"
PROJECT_ROOT="/Users/Kongphop-Doppio/Desktop/Kong/EventWebQueue"

# Clear file
echo "# Source Code Summary" > "$OUTPUT_FILE"
echo "Generated on $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

add_file() {
    FILE_PATH="$1"
    REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"
    EXT="${FILE_PATH##*.}"
    
    if [ -f "$FILE_PATH" ]; then
        echo "## $REL_PATH" >> "$OUTPUT_FILE"
        echo "\`\`\`$EXT" >> "$OUTPUT_FILE"
        cat "$FILE_PATH" >> "$OUTPUT_FILE"
        echo "\`\`\`" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
    else
        echo "## $REL_PATH (NOT FOUND)" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
    fi
}

# Core
add_file "$PROJECT_ROOT/src/App.tsx"
add_file "$PROJECT_ROOT/src/main.tsx"
add_file "$PROJECT_ROOT/src/supabaseClient.ts"
add_file "$PROJECT_ROOT/src/AppSupabase.tsx"

# Hooks
add_file "$PROJECT_ROOT/src/hooks/useArtistRealtime.ts"
add_file "$PROJECT_ROOT/src/hooks/useMidnightTick.ts"

# Components
add_file "$PROJECT_ROOT/src/components/CustomerHeader.tsx"
add_file "$PROJECT_ROOT/src/components/StickyBanner.tsx"
add_file "$PROJECT_ROOT/src/components/ui/index.ts"
add_file "$PROJECT_ROOT/src/components/ui/Button.tsx"
add_file "$PROJECT_ROOT/src/components/ui/Card.tsx"

# Pages (Customer)
add_file "$PROJECT_ROOT/src/pages/customer/CustomerLayout.tsx"
add_file "$PROJECT_ROOT/src/pages/customer/Home.tsx"
add_file "$PROJECT_ROOT/src/pages/customer/MenuView.tsx"
add_file "$PROJECT_ROOT/src/pages/customer/QueueView.tsx"

# Pages (Creators)
add_file "$PROJECT_ROOT/src/pages/creators/SupabaseDashboard.tsx"
add_file "$PROJECT_ROOT/src/pages/creators/ManageArtist.tsx"
add_file "$PROJECT_ROOT/src/pages/creators/ManageProducts.tsx"

# Auth
add_file "$PROJECT_ROOT/src/pages/Login.tsx"
add_file "$PROJECT_ROOT/src/pages/SupabaseLogin.tsx"

echo "Summary Generated at $OUTPUT_FILE"
