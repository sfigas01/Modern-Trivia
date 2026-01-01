# Admin Setup Guide

## Granting Admin Access

After setting up authentication, you'll need to designate which users can access the admin panel. Admin access is **not automatic** - users must be explicitly granted the admin role.

### Step 1: User Must Log In First

Before granting admin access, the user must sign in to the application at least once. This creates their user record in the database.

1. Go to the home page of your application
2. Click "Sign in with Replit"
3. Complete the authentication flow

### Step 2: Grant Admin Access

After the user has logged in at least once, use the database tools to grant them admin access.

#### Option A: Using the Replit Database Tool

1. Open the Database tab in your Replit workspace
2. Navigate to the `admin_roles` table
3. Insert a new row with the user's ID:
   ```sql
   INSERT INTO admin_roles (user_id) VALUES ('USER_ID_HERE');
   ```

#### Option B: Using SQL Query Tool

Run this SQL command (replace `YOUR_EMAIL` with the actual email):

```sql
-- First, find the user's ID
SELECT id, email, username FROM users WHERE email = 'YOUR_EMAIL';

-- Then grant admin access using the ID
INSERT INTO admin_roles (user_id) VALUES ('the-id-from-above');
```

### Step 3: Verify Admin Access

1. Refresh the application
2. The "Admin Panel" link should now appear in the navigation
3. Click it to access the admin panel and manage disputes

## Admin Features

Once granted admin access, users can:

- **View all disputes** submitted by players
- **Review disputed questions** with team explanations
- **Clear disputes** after reviewing them
- **Access admin-only sections** of the application

## Security Notes

- Admin access is stored in a separate `admin_roles` table
- All admin routes require both authentication AND admin role verification
- Regular users can still submit disputes (requires authentication)
- Only admins can view and manage disputes
