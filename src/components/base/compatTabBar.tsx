import React from "react";
import { TabBar, TabBarItem } from "react-native-tab-view";
import type {
    TabBarItemProps,
    TabBarProps,
    Route,
} from "react-native-tab-view";

type TabBarItemWithKeyProps<T extends Route> = TabBarItemProps<T> & {
    key: string;
};

/**
 * react-native-tab-view 3.5.2 会把 key 放进 spread props。
 * React 18.3 开始对此提示 warning，这里显式提取 key 后再渲染。
 */
function renderTabBarItem<T extends Route>({
    key,
    ...props
}: TabBarItemWithKeyProps<T>) {
    return <TabBarItem key={key} {...props} />;
}

export function CompatTabBar<T extends Route>(props: TabBarProps<T>) {
    return <TabBar {...props} renderTabBarItem={renderTabBarItem} />;
}
