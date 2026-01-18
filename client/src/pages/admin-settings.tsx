import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Save, LogIn, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";
import { useLocation } from "wouter";

export default function AdminSettings() {
    const [_, setLocation] = useLocation();
    const { toast } = useToast();
    const { user, isLoading: authLoading, isAuthenticated } = useAuth();
    const { isAdmin, isLoading: adminLoading } = useAdmin();
    const [loading, setLoading] = useState(false);
    const [openaiKey, setOpenaiKey] = useState("");

    const handleSave = async () => {
        setLoading(true);
        try {
            if (openaiKey) {
                await apiRequest("POST", "/api/admin/config", {
                    key: "openai_api_key",
                    value: openaiKey
                });
            }
            toast({ title: "Settings Saved", description: "Configuration updated successfully." });
            setOpenaiKey("");
        } catch (error) {
            toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (authLoading || adminLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
                    <p className="text-muted-foreground">Checking permissions...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-6">
                <Card className="max-w-md w-full bg-white/5 border-white/10">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                            <Shield className="w-8 h-8 text-primary" />
                        </div>
                        <CardTitle className="text-2xl">Admin Access Required</CardTitle>
                        <CardDescription>
                            Please sign in to access the admin panel
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button 
                            className="w-full" 
                            size="lg"
                            onClick={() => window.location.href = "/api/login"}
                        >
                            <LogIn className="w-4 h-4 mr-2" />
                            Sign In with Replit
                        </Button>
                        <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={() => setLocation("/")}
                        >
                            Back to Home
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-6">
                <Card className="max-w-md w-full bg-white/5 border-white/10 border-red-500/30">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
                            <Shield className="w-8 h-8 text-red-500" />
                        </div>
                        <CardTitle className="text-2xl">Access Denied</CardTitle>
                        <CardDescription>
                            You don't have admin permissions. Contact an administrator to get access.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-3 bg-muted/50 rounded-lg text-sm">
                            <p className="text-muted-foreground">Signed in as:</p>
                            <p className="font-medium">{user?.email || "Unknown user"}</p>
                        </div>
                        <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={() => setLocation("/")}
                        >
                            Back to Home
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
                    <p className="text-muted-foreground">Configure AI providers and system preferences.</p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card className="bg-white/5 border-white/10">
                        <CardHeader>
                            <CardTitle>AI Providers</CardTitle>
                            <CardDescription>Enter API keys for the services you want to use.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="openai">OpenAI API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="openai"
                                        type="password"
                                        placeholder="sk-..."
                                        value={openaiKey}
                                        onChange={(e) => setOpenaiKey(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">Keys are stored securely and never returned to the client.</p>
                            </div>

                            <Button onClick={handleSave} disabled={loading}>
                                <Save className="w-4 h-4 mr-2" />
                                {loading ? "Saving..." : "Save Configuration"}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </AdminLayout>
    );
}
