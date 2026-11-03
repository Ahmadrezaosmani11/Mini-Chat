; Custom NSIS hooks: firewall rules (LocalSubnet, Private+Domain) and uninstall data prompt.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="DTP2P Discovery UDP 37020"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="DTP2P Peer TCP 37021"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="DTP2P Discovery UDP 37020" dir=in action=allow protocol=UDP localport=37020 remoteip=LocalSubnet profile=private,domain program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="DTP2P Peer TCP 37021" dir=in action=allow protocol=TCP localport=37021 remoteip=LocalSubnet profile=private,domain program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="DTP2P Discovery UDP 37020"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="DTP2P Peer TCP 37021"'
  MessageBox MB_YESNO|MB_DEFBUTTON2 "Also delete my account and all data?" IDYES delData IDNO keepData
  delData:
    RMDir /r "$APPDATA\DTP2P"
  keepData:
!macroend
