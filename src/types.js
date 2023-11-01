const propertyIds = {
    NOTIFICATION: 'P1',
    ON : 'P3',
    AVAILABLE : 'P5',
    BRIGHTNESS : 'P1501',
    COLOR_TEMP : 'P1502',
    CAMERA_SIREN : 'P1049',
    CAMERA_FLOOD_LIGHT : 'P1056',
}

const wyzeWallSwitch = {
    CLASSIC: 1, // Classic Control
    IOT: 2, // Smart Control
  }

const wyzeColorProperty = {
    WYZE_COLOR_TEMP_MIN : 2700,
    WYZE_COLOR_TEMP_MAX : 6500,
}

const homeKitColorProperty = {
    HOMEKIT_COLOR_TEMP_MIN : 500,
    HOMEKIT_COLOR_TEMP_MAX : 140,
}

const wyze2HomekitUnits = {
    C: 0,
    F: 1
}

const wyze2HomekitStates = {
    off: 0,
    heat: 1,
    cool: 2,
    auto: 3
}

const wyze2HomekitWorkingStates = {
    idle: 0,
    heating: 1,
    cooling: 2
} 