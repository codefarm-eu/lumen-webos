#!/bin/sh
# One manual re-pair of the Stadia controller, step by step, for testing on the TV.
B=luna://com.webos.service.bluetooth2
A=$1
st () { luna-send -n 1 -f $B/device/getStatus '{}' | tr -d ' \n' | grep -o "{[^{}]*\"address\":\"$A\"[^{}]*}" | grep -o '"paired":[a-z]*\|"connectedProfiles":\[[^]]*\]' | tr '\n' ' '; }
echo "$(date +%T) before: $(st)"
luna-send -n 1 $B/adapter/unpair "{\"address\":\"$A\"}"; echo
sleep 2
timeout 60 luna-send -i $B/adapter/startDiscovery '{}' >/dev/null 2>&1 &
sleep 4
echo "$(date +%T) pair:"
timeout 30 luna-send -n 2 $B/adapter/pair "{\"address\":\"$A\",\"subscribe\":true}"; echo
sleep 2
echo "$(date +%T) after pair: $(st)"
grep -q Stadia /proc/bus/input/devices || { timeout 15 luna-send -n 1 $B/hid/connect "{\"address\":\"$A\"}"; echo; sleep 3; }
echo "$(date +%T) input device: $(grep -c Stadia /proc/bus/input/devices)  status: $(st)"
h=$(for x in $(ls /sys/class/hidraw/); do readlink /sys/class/hidraw/$x | grep -q 18D1 && echo $x; done | tail -1)
[ -n "$h" ] || exit 0
echo "$(date +%T) press buttons now (15 s, reading /dev/$h)"
cat /dev/$h > /tmp/gp_raw 2>/dev/null & p=$!
sleep 15; kill $p
echo "$(date +%T) raw report bytes: $(wc -c < /tmp/gp_raw)"
