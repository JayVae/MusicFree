import React from "react";

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PluginList from "./views/pluginList";
import PluginSort from "./views/pluginSort";
import PluginSubscribe from "./views/pluginSubscribe";
import PluginSubscriptionDetail from "./views/pluginSubscriptionDetail";
import PluginOriginDetail from "./views/pluginOriginDetail";

const Stack = createNativeStackNavigator<any>();

const routes = [
    {
        path: "/pluginsetting/list",
        component: PluginList,
    },
    {
        path: "/pluginsetting/sort",
        component: PluginSort,
    },
    {
        path: "/pluginsetting/subscribe",
        component: PluginSubscribe,
    },
    {
        path: "/pluginsetting/subscribe/detail",
        component: PluginSubscriptionDetail,
    },
    {
        path: "/pluginsetting/origin/detail",
        component: PluginOriginDetail,
    },
];

export default function PluginSetting() {
    return (
        <Stack.Navigator
            initialRouteName={routes[0].path}
            screenOptions={{
                headerShown: false,
                animation: "slide_from_right",
                animationDuration: 100,
            }}>
            {routes.map(route => (
                <Stack.Screen
                    key={route.path}
                    name={route.path}
                    component={route.component}
                />
            ))}
        </Stack.Navigator>
    );
}
